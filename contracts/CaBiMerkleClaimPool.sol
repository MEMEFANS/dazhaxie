// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * CaBiMerkleClaimPool
 * Merkle 自领领取池：不依赖认购合约，服务器不持有任何私钥。
 *
 * 流程：
 * 1. owner 把 CaBi 代币直接转入本合约，作为发放储备。
 * 2. 后台按「已核验认购单 + 直推奖励 + 团队极差」算出每个地址的累计应得额度，
 *    生成 Merkle root 与每人 proof；owner 用自己的钱包调用 setMerkleRoot(root, epoch) 发布批次。
 * 3. 用户带 proof 调用 claim(累计额度, proof)，合约只发放「累计额度 - 已领额度」的差额。
 *
 * 领取规则（唯一路径）：
 * - 本次差额发 70% 给用户；剩余 30% CaBi 转入 LP 接收地址，
 *   同时由用户支付 30% USDT 等值（单价 50 USDT / 份、每份 35000 CaBi）转入同一 LP 接收地址。
 * - LP 接收地址或 USDT 未配置、USDT 余额或授权不足时，整笔领取直接 revert。
 *
 * 安全要点：leaf 绑定 chainId 无关的 epoch、账户与累计额度；root 只能由 owner 更新且 epoch 单调递增；
 * claimedOf 记录累计已领，重复领取或低额度 root 不会多发；nonReentrant、迷你 SafeERC20、
 * 余额不足整体 revert、owner 两步交接。
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

contract CaBiMerkleClaimPool {
    using SafeERC20Mini for IERC20;

    uint256 public constant UNIT_PRICE = 50; // USDT / 份
    uint256 public constant TOKENS_PER_SHARE = 35_000 * 1e18; // 18 位 CaBi
    uint256 public constant RATIO_DENOMINATOR = 100;
    uint256 public constant PAYOUT_RATIO = 70; // 用户实得（唯一领取路径）
    uint256 public constant LP_TOKEN_RATIO = 30; // 进入 LP 接收地址的代币比例
    uint256 public constant LP_USDT_RATIO = 30; // 用户另付的 USDT 等值比例

    address public immutable token;
    address public usdt;
    uint8 public usdtDecimals = 18;
    address public owner;
    address public pendingOwner;
    address public lpReceiver;

    bytes32 public merkleRoot;
    uint256 public epoch;

    mapping(address => uint256) public claimedOf; // 累计已领取（CaBi 最小单位）
    uint256 public totalClaimed;
    uint256 public totalLpTokens;
    uint256 public totalUsdtCharged;

    uint256 private locked = 1;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event MerkleRootUpdated(bytes32 indexed previousRoot, bytes32 indexed newRoot, uint256 previousEpoch, uint256 newEpoch);
    event Claimed(
        address indexed user,
        uint256 cumulativeAmount,
        uint256 delta,
        uint256 epoch,
        uint256 payout,
        uint256 lpTokens,
        uint256 usdtCharged
    );
    event LpReceiverUpdated(address indexed previousReceiver, address indexed newReceiver);
    event UsdtUpdated(address indexed previousUsdt, address indexed newUsdt);

    error NotOwner();
    error ZeroAddress();
    error InvalidAmount();
    error InvalidRoot();
    error InvalidProof();
    error EpochNotAdvanced();
    error RootUnset();
    error AlreadyClaimed();
    error LpReceiverUnset();
    error UsdtUnset();
    error LpPaymentFailed();
    error InsufficientPoolBalance();
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

    constructor(address token_, address owner_) {
        if (token_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        token = token_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
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

    /// 发布新一批累计额度 root；epoch 必须严格递增，防止回滚到旧批次。
    function setMerkleRoot(bytes32 root, uint256 newEpoch) external onlyOwner {
        if (root == bytes32(0)) revert InvalidRoot();
        if (newEpoch <= epoch) revert EpochNotAdvanced();
        bytes32 previousRoot = merkleRoot;
        uint256 previousEpoch = epoch;
        merkleRoot = root;
        epoch = newEpoch;
        emit MerkleRootUpdated(previousRoot, root, previousEpoch, newEpoch);
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

    // ---------------------------------------------------------------- claim
    /**
     * @param cumulativeAmount 该地址在当前 epoch 的累计应得总额度（不是本次增量）
     * @param proof Merkle proof
     */
    function claim(uint256 cumulativeAmount, bytes32[] calldata proof) external nonReentrant {
        uint256 claimed = claimedOf[msg.sender];
        if (cumulativeAmount <= claimed) revert AlreadyClaimed();
        if (cumulativeAmount == 0) revert InvalidAmount();
        bytes32 root = merkleRoot;
        if (root == bytes32(0)) revert RootUnset();
        if (!_verify(proof, root, _leaf(msg.sender, cumulativeAmount))) revert InvalidProof();

        uint256 delta = cumulativeAmount - claimed;
        claimedOf[msg.sender] = cumulativeAmount;
        totalClaimed += delta;

        Settlement memory settlement = _settle(delta);
        emit Claimed(msg.sender, cumulativeAmount, delta, epoch, settlement.payout, settlement.lpTokens, settlement.usdtCharged);
    }

    struct Settlement {
        uint256 payout;
        uint256 lpTokens;
        uint256 usdtCharged;
    }

    function _settle(uint256 delta) private returns (Settlement memory settlement) {
        settlement.payout = delta * PAYOUT_RATIO / RATIO_DENOMINATOR;
        settlement.lpTokens = delta - settlement.payout;
        settlement.usdtCharged = _usdtEquivalent(delta);
        if (settlement.usdtCharged == 0) revert InvalidAmount();

        address receiver = lpReceiver;
        if (receiver == address(0)) revert LpReceiverUnset();
        address usdtToken = usdt;
        if (usdtToken == address(0)) revert UsdtUnset();

        if (IERC20(token).balanceOf(address(this)) < settlement.payout + settlement.lpTokens) {
            revert InsufficientPoolBalance();
        }
        if (IERC20(usdtToken).balanceOf(msg.sender) < settlement.usdtCharged) revert LpPaymentFailed();
        if (IERC20(usdtToken).allowance(msg.sender, address(this)) < settlement.usdtCharged) revert LpPaymentFailed();

        totalLpTokens += settlement.lpTokens;
        totalUsdtCharged += settlement.usdtCharged;
        // 未授权或余额不足时整笔领取回滚（不会只发 70%）。
        IERC20(usdtToken).safeTransferFrom(msg.sender, receiver, settlement.usdtCharged);
        IERC20(token).safeTransfer(receiver, settlement.lpTokens);
        IERC20(token).safeTransfer(msg.sender, settlement.payout);
    }

    function _usdtEquivalent(uint256 amount) private view returns (uint256) {
        return amount * UNIT_PRICE * LP_USDT_RATIO * (10 ** usdtDecimals)
            / (TOKENS_PER_SHARE * RATIO_DENOMINATOR);
    }

    function _leaf(address account, uint256 cumulativeAmount) private view returns (bytes32) {
        return keccak256(abi.encode(account, cumulativeAmount, epoch));
    }

    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) private pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            computed = computed <= sibling
                ? keccak256(abi.encodePacked(computed, sibling))
                : keccak256(abi.encodePacked(sibling, computed));
        }
        return computed == root;
    }

    // -------------------------------------------------------------- preview
    /// @param cumulativeAmount 当前 epoch 的累计应得额度；返回值中的 delta 为本次实发差额。
    function previewClaim(address user, uint256 cumulativeAmount)
        public
        view
        returns (uint256 delta, uint256 payout, uint256 lpTokens, uint256 usdtRequired)
    {
        uint256 claimed = claimedOf[user];
        delta = cumulativeAmount > claimed ? cumulativeAmount - claimed : 0;
        payout = delta * PAYOUT_RATIO / RATIO_DENOMINATOR;
        lpTokens = delta - payout;
        usdtRequired = _usdtEquivalent(delta);
    }

    function poolBalance() public view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
