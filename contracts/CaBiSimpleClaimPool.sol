// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * CaBiSimpleClaimPool
 * 独立领取池：不依赖任何认购合约。服务器/运营钱包通过 batchSetClaimable 写入额度，
 * 用户自行领取。私钥不应进入 Web 服务；推荐使用 scripts/push-claimable.cjs 离线签名广播。
 *
 * 领取规则（与现行业务口径一致）：
 * - mode 0：领取可领额度的 50%；剩余 50% 在 burnRemainder=true 时销毁，否则留在池内。
 * - mode 1：领取可领额度的 70%；剩余 30% CaBi 转入项目 LP 接收地址；
 *   同时按 30% USDT 等值收取配对资金（单价 50 USDT / 份、每份 35000 CaBi）。
 *
 * 安全要点：nonReentrant、迷你 SafeERC20、零地址校验、余额不足整体 revert、
 * 已领取地址禁止再次写入额度、owner 两步交接。
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

contract CaBiSimpleClaimPool {
    using SafeERC20Mini for IERC20;

    uint256 public constant UNIT_PRICE = 50; // USDT / 份
    uint256 public constant TOKENS_PER_SHARE = 35_000 * 1e18; // 18 位 CaBi
    uint256 public constant RATIO_DENOMINATOR = 100;
    uint256 public constant MAX_BATCH = 200;

    address public token;
    address public usdt;
    uint8 public usdtDecimals = 18;
    address public owner;
    address public pendingOwner;
    address public lpReceiver;
    bool public burnRemainder = true;

    // 比例，单位百分比；setter 上限 100。默认与现行业务一致。
    uint256 public directRatio = 50; // mode 0 用户实得
    uint256 public lpRatio = 70; // mode 1 用户实得
    uint256 public lpTokenRatio = 30; // mode 1 进入 LP 接收地址代币
    uint256 public lpUsdtRatio = 30; // mode 1 另付 USDT 等值

    mapping(address => uint256) public claimableOf;
    mapping(address => bool) public hasClaimed;
    mapping(address => ClaimRecord) public claims;

    struct ClaimRecord {
        bool claimed;
        uint8 mode;
        uint256 entitlement;
        uint256 payout;
    }

    uint256 public totalAllocated; // 累计写入额度（含已领取）
    uint256 public totalClaimed; // 累计已消费额度（整份额度）
    uint256 public totalBurned; // 累计销毁 CaBi
    uint256 public totalLpTokens; // 累计转入 LP 接收地址的 CaBi
    uint256 public totalUsdtCharged; // 累计收取的 USDT 最小单位

    uint256 private locked = 1;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event Deposit(address indexed from, uint256 amount);
    event WithdrawUnused(address indexed to, uint256 amount);
    event ClaimableSet(address indexed user, uint256 previousAmount, uint256 newAmount, bool incremental);
    event Claimed(address indexed user, uint8 indexed mode, uint256 entitlement, uint256 payout, uint256 burnAmount, uint256 lpTokens, uint256 usdtCharged);
    event LpReceiverUpdated(address indexed previousReceiver, address indexed newReceiver);
    event UsdtUpdated(address indexed previousUsdt, address indexed newUsdt);
    event BurnRemainderUpdated(bool enabled);
    event RatiosUpdated(uint256 directRatio, uint256 lpRatio, uint256 lpTokenRatio, uint256 lpUsdtRatio);

    error NotOwner();
    error ZeroAddress();
    error InvalidAmount();
    error InvalidArrayLength();
    error BatchTooLarge();
    error AlreadyClaimed();
    error InvalidMode();
    error ClaimableZero();
    error InsufficientPoolBalance();
    error LpReceiverUnset();
    error UsdtUnset();
    error RatioInvalid();
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

    function setUsdt(address usdt_) external onlyOwner {
        if (usdt_ == address(0)) revert ZeroAddress();
        uint8 decimals = IERC20(usdt_).decimals();
        if (decimals > 18) revert RatioInvalid();
        address previous = usdt;
        usdt = usdt_;
        usdtDecimals = decimals;
        emit UsdtUpdated(previous, usdt_);
    }

    function setLpReceiver(address receiver) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        address previous = lpReceiver;
        lpReceiver = receiver;
        emit LpReceiverUpdated(previous, receiver);
    }

    function setBurnRemainder(bool enabled) external onlyOwner {
        burnRemainder = enabled;
        emit BurnRemainderUpdated(enabled);
    }

    function setRatios(uint256 direct, uint256 lp, uint256 lpToken, uint256 lpUsdt) external onlyOwner {
        if (direct == 0 || direct > RATIO_DENOMINATOR || lp == 0 || lp > RATIO_DENOMINATOR) revert RatioInvalid();
        // mode 1 的 LP 份额按“可领额度减去用户实得”计算，因此 lpToken 必须等于 100 - lp。
        if (lpToken != RATIO_DENOMINATOR - lp) revert RatioInvalid();
        if (lpUsdt == 0 || lpUsdt > RATIO_DENOMINATOR) revert RatioInvalid();
        directRatio = direct;
        lpRatio = lp;
        lpTokenRatio = lpToken;
        lpUsdtRatio = lpUsdt;
        emit RatiosUpdated(direct, lp, lpToken, lpUsdt);
    }

    // ------------------------------------------------------------- funding
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(msg.sender, amount);
    }

    function withdrawUnused(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (amount > unusedBalance()) revert InsufficientPoolBalance();
        IERC20(token).safeTransfer(owner, amount);
        emit WithdrawUnused(owner, amount);
    }

    // ------------------------------------------------------------- allocation
    function batchSetClaimable(address[] calldata users, uint256[] calldata amounts, bool incremental) external onlyOwner {
        if (users.length != amounts.length) revert InvalidArrayLength();
        if (users.length == 0 || users.length > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            if (user == address(0)) revert ZeroAddress();
            if (hasClaimed[user]) revert AlreadyClaimed();
            uint256 previous = claimableOf[user];
            uint256 next = incremental ? previous + amounts[i] : amounts[i];
            if (incremental && amounts[i] == 0) continue;
            if (incremental) {
                totalAllocated += amounts[i];
            } else {
                totalAllocated = totalAllocated - previous + next;
            }
            claimableOf[user] = next;
            emit ClaimableSet(user, previous, next, incremental);
        }
    }

    // ---------------------------------------------------------------- claim
    function claim(uint8 mode) external nonReentrant {
        if (mode != 0 && mode != 1) revert InvalidMode();
        uint256 entitlement = claimableOf[msg.sender];
        if (entitlement == 0) revert ClaimableZero();
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        hasClaimed[msg.sender] = true;
        claimableOf[msg.sender] = 0;
        totalClaimed += entitlement;

        uint256 payout;
        uint256 remainder;
        uint256 lpTokens;
        uint256 usdtCharged;

        if (mode == 0) {
            payout = entitlement * directRatio / RATIO_DENOMINATOR;
            remainder = entitlement - payout;
            if (burnRemainder) {
                totalBurned += remainder;
                IERC20(token).safeTransfer(address(0x000000000000000000000000000000000000dEaD), remainder);
            }
        } else {
            payout = entitlement * lpRatio / RATIO_DENOMINATOR;
            lpTokens = entitlement - payout;
            address receiver = lpReceiver;
            if (receiver == address(0)) revert LpReceiverUnset();
            address usdtToken = usdt;
            if (usdtToken == address(0)) revert UsdtUnset();
            usdtCharged = entitlement * UNIT_PRICE * lpUsdtRatio * (10 ** usdtDecimals) / (TOKENS_PER_SHARE * RATIO_DENOMINATOR);
            if (usdtCharged == 0) revert InvalidAmount();
            totalLpTokens += lpTokens;
            totalUsdtCharged += usdtCharged;
        }

        if (IERC20(token).balanceOf(address(this)) < payout + lpTokens) revert InsufficientPoolBalance();

        claims[msg.sender] = ClaimRecord({claimed: true, mode: mode, entitlement: entitlement, payout: payout});

        if (mode == 1) {
            address receiver = lpReceiver;
            IERC20(usdt).safeTransferFrom(msg.sender, receiver, usdtCharged);
            IERC20(token).safeTransfer(receiver, lpTokens);
        }
        IERC20(token).safeTransfer(msg.sender, payout);

        emit Claimed(msg.sender, mode, entitlement, payout, remainder, lpTokens, usdtCharged);
    }

    // -------------------------------------------------------------- preview
    function previewClaim(address user, uint8 mode)
        external
        view
        returns (uint256 entitlement, uint256 payout, uint256 burnAmount, uint256 lpTokens, uint256 usdtRequired)
    {
        if (mode != 0 && mode != 1) revert InvalidMode();
        entitlement = claimableOf[user];
        if (mode == 0) {
            payout = entitlement * directRatio / RATIO_DENOMINATOR;
            burnAmount = burnRemainder ? entitlement - payout : 0;
            lpTokens = 0;
            usdtRequired = 0;
        } else {
            payout = entitlement * lpRatio / RATIO_DENOMINATOR;
            burnAmount = 0;
            lpTokens = entitlement - payout;
            usdtRequired = entitlement * UNIT_PRICE * lpUsdtRatio * (10 ** usdtDecimals) / (TOKENS_PER_SHARE * RATIO_DENOMINATOR);
        }
    }

    function poolBalance() public view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function allocatedUnclaimed() public view returns (uint256) {
        return totalAllocated - totalClaimed;
    }

    function unusedBalance() public view returns (uint256) {
        uint256 balance = poolBalance();
        uint256 reserved = allocatedUnclaimed();
        return balance > reserved ? balance - reserved : 0;
    }
}
