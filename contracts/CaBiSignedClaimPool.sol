// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * CaBiSignedClaimPool
 * 签名自领领取池：不依赖认购合约，也不需要 owner 逐人写入额度。
 *
 * 流程：Web 服务按「认购单 + 直推奖励 + 极差结算」聚合出每个地址的待领额度，
 * 用只具备签名权限的 CLAIM_SIGNER 私钥签发 EIP-712 授权；用户拿签名调用 claim 自己去领。
 *
 * 权限边界：
 * - signer：只能签发领取授权，不能转移池内资金、不能换 owner。
 * - owner：只能存币、取回未分配余额、换 signer、配置 USDT / LP 接收地址与可选限额，
 *   不能代替用户领取，也不能替用户签授权。
 *
 * 领取规则（唯一路径）：
 * - 本次授权额度发 70% 给用户；剩余 30% CaBi 转入项目 LP 接收地址，
 *   同时由用户支付 30% USDT 等值（单价 50 USDT / 份、每份 35000 CaBi）转入同一 LP 接收地址。
 * - LP 接收地址或 USDT 未配置、USDT 余额或授权不足时，整笔领取直接 revert。
 *
 * 安全要点：EIP-712 结构化摘要（含 chainId 与合约地址，防跨链/跨合约重放）、
 * nonce 一次性（防同链重放）、deadline 过期、金额与额度上限校验、nonReentrant、
 * 迷你 SafeERC20、零地址校验、余额不足整体 revert、owner 两步交接。
 */
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

library SafeERC20Mini {
    error SafeTransferFailed();
    error SafeTransferFromFailed();

    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transfer, (to, value)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert SafeTransferFailed();
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transferFrom, (from, to, value)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert SafeTransferFromFailed();
    }
}

contract CaBiSignedClaimPool {
    using SafeERC20Mini for IERC20;

    uint256 public constant UNIT_PRICE = 50; // USDT / 份
    uint256 public constant TOKENS_PER_SHARE = 35_000 * 1e18; // 18 位 CaBi
    uint256 public constant RATIO_DENOMINATOR = 100;
    uint256 public constant PAYOUT_RATIO = 70; // 用户实得（唯一领取路径）
    uint256 public constant LP_TOKEN_RATIO = 30; // 进入 LP 接收地址的代币比例
    uint256 public constant LP_USDT_RATIO = 30; // 用户另付的 USDT 等值比例

    // EIP-712：Claim(address user,uint256 amount,uint256 nonce,uint256 deadline)
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address user,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant DOMAIN_NAME_HASH = keccak256(bytes("CaBiSignedClaimPool"));
    bytes32 public constant DOMAIN_VERSION_HASH = keccak256(bytes("1"));

    address public token;
    address public signer;
    address public usdt;
    uint8 public usdtDecimals = 18;
    address public owner;
    address public pendingOwner;
    address public lpReceiver;

    // 每个地址的累计授权上限；0 表示不额外限制（由签名金额与 nonce 控制）。
    mapping(address => uint256) public claimLimitOf;
    uint256 public totalLimit;

    mapping(address => uint256) public claimedOf; // 累计已领取（整份额度）
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    uint256 public totalClaimed;
    uint256 public totalLpTokens;
    uint256 public totalUsdtCharged;

    uint256 private locked = 1;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event SignerChanged(address indexed previousSigner, address indexed newSigner);
    event Deposit(address indexed from, uint256 amount);
    event WithdrawUnused(address indexed to, uint256 amount);
    event ClaimLimitUpdated(address indexed user, uint256 previousLimit, uint256 newLimit);
    event Claimed(
        address indexed user,
        uint256 amount,
        uint256 nonce,
        uint256 payout,
        uint256 lpTokens,
        uint256 usdtCharged
    );
    event LpReceiverUpdated(address indexed previousReceiver, address indexed newReceiver);
    event UsdtUpdated(address indexed previousUsdt, address indexed newUsdt);

    error NotOwner();
    error ZeroAddress();
    error InvalidAmount();
    error InvalidSignature();
    error SignatureExpired();
    error NonceUsed();
    error SignerUnset();
    error ClaimLimitExceeded();
    error InsufficientPoolBalance();
    error LpReceiverUnset();
    error UsdtUnset();
    error Reentrancy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address token_, address signer_, address owner_) {
        if (token_ == address(0) || signer_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        token = token_;
        signer = signer_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
        emit SignerChanged(address(0), signer_);
    }

    // ------------------------------------------------------------ EIP-712
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, block.chainid, address(this)));
    }

    /// 供服务端/前端核对：返回某个授权参数组合的摘要（不校验签名）。
    function claimDigest(address user, uint256 amount, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                keccak256(abi.encode(CLAIM_TYPEHASH, user, amount, nonce, deadline))
            )
        );
    }

    // ---------------------------------------------------------------- owner
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        address previous = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, owner);
    }

    /// 换签名服务地址：旧 signer 签发的未领取授权立即失效（签名里绑定了 signer 校验）。
    function setSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        address previous = signer;
        signer = newSigner;
        emit SignerChanged(previous, newSigner);
    }

    function setUsdt(address usdt_) external onlyOwner {
        if (usdt_ == address(0)) revert ZeroAddress();
        uint8 decimals = IERC20(usdt_).decimals();
        if (decimals > 18) revert InvalidAmount();
        address previous = usdt;
        usdt = usdt_;
        usdtDecimals = decimals;
        emit UsdtUpdated(previous, usdt_);
    }

    /// 领取代币与用户支付的 USDT 都进入该地址；未配置时领取直接 revert。
    function setLpReceiver(address receiver) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        address previous = lpReceiver;
        lpReceiver = receiver;
        emit LpReceiverUpdated(previous, receiver);
    }

    /// 可选的每地址累计上限（0 = 不额外限制）；用于风控兜底，不是正常发放路径。
    function setClaimLimit(address user, uint256 limit) external onlyOwner {
        if (user == address(0)) revert ZeroAddress();
        uint256 previous = claimLimitOf[user];
        totalLimit = totalLimit - previous + limit;
        claimLimitOf[user] = limit;
        emit ClaimLimitUpdated(user, previous, limit);
    }

    // ------------------------------------------------------------- funding
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(msg.sender, amount);
    }

    /// 只能取回未被 owner 设定限额的未分配部分；正常签名模式下未分配 = 全部池余额。
    function withdrawUnused(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (amount > unusedBalance()) revert InsufficientPoolBalance();
        IERC20(token).safeTransfer(owner, amount);
        emit WithdrawUnused(owner, amount);
    }

    // ---------------------------------------------------------------- claim
    function claim(uint256 amount, uint256 nonce, uint256 deadline, bytes calldata signature)
        external
        nonReentrant
    {
        if (amount == 0) revert InvalidAmount();
        if (deadline < block.timestamp) revert SignatureExpired();
        if (nonceUsed[msg.sender][nonce]) revert NonceUsed();
        address currentSigner = signer;
        if (currentSigner == address(0)) revert SignerUnset();
        if (_recover(claimDigest(msg.sender, amount, nonce, deadline), signature) != currentSigner) {
            revert InvalidSignature();
        }
        _checkLimit(msg.sender, amount);

        nonceUsed[msg.sender][nonce] = true;
        claimedOf[msg.sender] += amount;
        totalClaimed += amount;

        Settlement memory settlement = _settle(amount);
        emit Claimed(
            msg.sender, amount, nonce, settlement.payout, settlement.lpTokens, settlement.usdtCharged
        );
    }

    struct Settlement {
        uint256 payout;
        uint256 lpTokens;
        uint256 usdtCharged;
    }

    function _checkLimit(address user, uint256 amount) private view {
        uint256 limit = claimLimitOf[user];
        if (limit != 0 && claimedOf[user] + amount > limit) revert ClaimLimitExceeded();
    }

    function _settle(uint256 amount) private returns (Settlement memory settlement) {
        settlement.payout = amount * PAYOUT_RATIO / RATIO_DENOMINATOR;
        settlement.lpTokens = amount - settlement.payout;
        settlement.usdtCharged = _usdtEquivalent(amount);
        if (settlement.usdtCharged == 0) revert InvalidAmount();

        address receiver = lpReceiver;
        if (receiver == address(0)) revert LpReceiverUnset();
        address usdtToken = usdt;
        if (usdtToken == address(0)) revert UsdtUnset();

        if (IERC20(token).balanceOf(address(this)) < settlement.payout + settlement.lpTokens) {
            revert InsufficientPoolBalance();
        }

        totalLpTokens += settlement.lpTokens;
        totalUsdtCharged += settlement.usdtCharged;
        // 未授权或余额不足时 transferFrom 会直接失败，整笔领取回滚（不会只发 70%）。
        IERC20(usdtToken).safeTransferFrom(msg.sender, receiver, settlement.usdtCharged);
        IERC20(token).safeTransfer(receiver, settlement.lpTokens);
        IERC20(token).safeTransfer(msg.sender, settlement.payout);
    }

    function _usdtEquivalent(uint256 amount) private view returns (uint256) {
        return amount * UNIT_PRICE * LP_USDT_RATIO * (10 ** usdtDecimals)
            / (TOKENS_PER_SHARE * RATIO_DENOMINATOR);
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        // 拒绝可锻造（high-s）签名，避免同一授权出现多个"有效"签名。
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(digest, v, r, s);
    }

    // -------------------------------------------------------------- preview
    function previewClaim(uint256 amount)
        public
        view
        returns (uint256 payout, uint256 lpTokens, uint256 usdtRequired)
    {
        payout = amount * PAYOUT_RATIO / RATIO_DENOMINATOR;
        lpTokens = amount - payout;
        usdtRequired = amount * UNIT_PRICE * LP_USDT_RATIO * (10 ** usdtDecimals)
            / (TOKENS_PER_SHARE * RATIO_DENOMINATOR);
    }

    function poolBalance() public view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// 仅统计 owner 显式设定过限额的地址；纯签名模式下为 0，真实待领额度由服务器聚合。
    function allocatedUnclaimed() public view returns (uint256) {
        return totalLimit > totalClaimed ? totalLimit - totalClaimed : 0;
    }

    function unusedBalance() public view returns (uint256) {
        uint256 balance = poolBalance();
        uint256 reserved = allocatedUnclaimed();
        return balance > reserved ? balance - reserved : 0;
    }
}
