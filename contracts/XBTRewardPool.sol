// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBEP20 {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/**
 * 蟹比特 CaBi 独立奖励池合约（BSC）
 *
 * 定位：额外推广/团队奖励经链下核算写入本池，由用户自行领取。
 * XBTSale中的直推奖励单独记账，不应重复导入本池。
 * 合约内不做任何上下级 / 团队计算，只认 claimable 数额。
 *
 * 规则：
 * - owner 预先 deposit() 存入代币，池内余额用于发放；
 *   withdrawUnused() 仅可取回「未分配」部分（池余额 − 已分配未领取）
 * - batchSetClaimable() 写入每个地址的可领额度（枚），支持增量追加 / 覆盖更新，仅 owner
 * - claim(mode) 二选一，一次选择永久不可更改：
 *   · mode 0（不组 LP）：领取可领额度的 50%，剩余 50% 默认打入黑洞销毁，
 *     owner 可通过 setBurnRemainder(false) 切换为留在池中
 *   · mode 1（金库模式）：70%代币给用户，30%代币转入金库；
 *     用户需同时支付 30% USDT 等值（按可领额度 × 认购单价折算）转入 LP / 金库地址，
 *     USDT 转账失败或余额不足直接 revert
 * - 金库模式不调用DEX，不自动创建或铸造LP。
 * - 写入配额时合计不得超过池内实际余额，禁止透支已分配额度。
 * - 比例默认为常量值，owner 可在上限内调整（不超过 100%，调整不会导致池子透支：
 *   支出始终按用户可领额度的百分比计算，且领取前校验池余额充足）
 */
contract XBTRewardPool {
    IBEP20 public immutable xbt; // CaBi 代币
    IBEP20 public immutable usdt; // USDT（BSC 主网 0x55d398326f99059fF775485246999027B3197955）

    // 比例默认值（常量），owner 可调但不得高于 MAX_RATIO
    uint256 public constant DEFAULT_DIRECT_RATIO = 50; // mode 0 用户领取 50%
    uint256 public constant DEFAULT_LP_RATIO = 70; // mode 1 用户领取 70%
    uint256 public constant DEFAULT_LP_USDT_RATIO = 30; // mode 1 用户支付 30% USDT 等值
    uint256 public constant MAX_RATIO = 100; // 比例上限保护
    uint256 public immutable UNIT_PRICE; // 50 USDT，按所选USDT精度计算
    uint256 public constant TOKENS_PER_SHARE = 35000 * 1e18; // 每份配额（折算 USDT 等值用）
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public owner;
    address public lpReceiver; // 金库接收地址，不是DEX交易对

    uint256 public directRatio = DEFAULT_DIRECT_RATIO; // mode 0 用户领取比例（%）
    uint256 public lpRatio = DEFAULT_LP_RATIO; // mode 1 用户领取比例（%），其余 100-lpRatio 入 LP
    uint256 public lpUsdtRatio = DEFAULT_LP_USDT_RATIO; // mode 1 用户支付 USDT 等值比例（%）
    bool public burnRemainder = true; // mode 0 剩余部分：true 销毁（黑洞）/ false 留在池中

    uint256 public totalAllocated; // 已分配未领取（所有地址 claimable 合计）
    uint256 public totalClaimed; // 已领取合计（用户实得）
    uint256 public totalBurned; // mode 0 剩余部分销毁累计

    mapping(address => uint256) public claimable; // 每个地址的可领额度（枚）

    struct ClaimInfo {
        bool claimed; // 是否已领取（一次性，不可更改）
        uint8 mode; // 所选模式：0 不组 LP / 1 组 LP
        uint256 amount; // 实得数量
    }
    mapping(address => ClaimInfo) public claims;

    uint256 private _status; // nonReentrant 锁

    event Deposited(address indexed operator, uint256 amount, uint256 poolBalance);
    event WithdrawnUnused(address indexed operator, uint256 amount, uint256 poolBalance);
    event ClaimableUpdated(address indexed user, uint256 oldAmount, uint256 newAmount, bool incremental);
    event Claimed(address indexed user, uint8 mode, uint256 payout, uint256 remainder, uint256 lpTokens, uint256 usdtPaid);
    event RemainderBurned(address indexed user, uint256 amount);
    event BurnRemainderSet(bool burn);
    event RatioUpdated(string name, uint256 value);
    event LpReceiverSet(address indexed to);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier nonReentrant() {
        require(_status != 2, "reentrant");
        _status = 2;
        _;
        _status = 1;
    }

    /**
     * @param xbtAddress CaBi 代币合约地址
     * @param usdtAddress USDT 合约地址
     * @param lpReceiver_ 金库接收地址（本合约不铸造LP）
     */
    constructor(address xbtAddress, address usdtAddress, address lpReceiver_) {
        require(xbtAddress != address(0) && usdtAddress != address(0) && lpReceiver_ != address(0), "zero address");
        require(xbtAddress.code.length > 0 && usdtAddress.code.length > 0 && xbtAddress != usdtAddress, "invalid assets");
        uint8 quoteDecimals = IBEP20(usdtAddress).decimals();
        require(quoteDecimals <= 18 && IBEP20(xbtAddress).decimals() == 18, "unsupported decimals");
        UNIT_PRICE = 50 * 10 ** uint256(quoteDecimals);
        owner = msg.sender;
        xbt = IBEP20(xbtAddress);
        usdt = IBEP20(usdtAddress);
        lpReceiver = lpReceiver_;
        _status = 1;
    }

    /// 池内代币余额
    function poolBalance() public view returns (uint256) {
        return xbt.balanceOf(address(this));
    }

    /// 未分配余额（可取回部分）= 池余额 − 已分配未领取
    function unusedBalance() public view returns (uint256) {
        uint256 bal = poolBalance();
        return bal > totalAllocated ? bal - totalAllocated : 0;
    }

    /**
     * owner 预存代币入池（调用前需先 approve 本合约）
     */
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "zero amount");
        uint256 beforeBalance = poolBalance();
        _safeTransferFrom(xbt, msg.sender, address(this), amount);
        require(poolBalance() == beforeBalance + amount, "unsupported transfer fee");
        emit Deposited(msg.sender, amount, poolBalance());
    }

    /**
     * owner 取回未使用部分（仅未分配余额可取，已分配未领取部分受保护）
     */
    function withdrawUnused(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "zero amount");
        require(amount <= unusedBalance(), "exceeds unused balance");
        _safeTransfer(xbt, msg.sender, amount);
        emit WithdrawnUnused(msg.sender, amount, poolBalance());
    }

    /**
     * 链下核算结果写入可领额度（仅 owner）
     * @param users 地址列表
     * @param amounts 可领额度（枚）
     * @param incremental true 增量追加 / false 覆盖更新
     * 已领取的地址不允许再写入（保证领取选择一次性不可更改）
     */
    function batchSetClaimable(address[] calldata users, uint256[] calldata amounts, bool incremental) external onlyOwner nonReentrant {
        require(users.length == amounts.length, "length mismatch");
        require(users.length > 0, "empty batch");
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            require(user != address(0), "zero address");
            require(!claims[user].claimed, "already claimed");
            uint256 oldAmount = claimable[user];
            uint256 newAmount = incremental ? oldAmount + amounts[i] : amounts[i];
            claimable[user] = newAmount;
            totalAllocated = totalAllocated - oldAmount + newAmount;
            emit ClaimableUpdated(user, oldAmount, newAmount, incremental);
        }
        require(poolBalance() >= totalAllocated, "allocation exceeds pool balance");
    }

    /**
     * 领取奖励（二选一，一次选择永久不可更改）
     * @param mode 0 不组 LP 领 50%（剩余默认销毁，可由 owner 切换为留池）
     *             1 金库模式领70%（30%代币入金库，另需支付30%USDT等值，
     *               调用前需先对 USDT 合约 approve 本合约相应额度）
     */
    function claim(uint8 mode) external nonReentrant {
        _claim(mode);
    }

    /// Bind a claim to the exact policy that the user reviewed before signing.
    function claimChecked(
        uint8 mode,
        uint256 expectedDirectRatio,
        uint256 expectedLpRatio,
        uint256 expectedLpUsdtRatio,
        address expectedLpReceiver,
        bool expectedBurnRemainder
    ) external nonReentrant {
        require(directRatio == expectedDirectRatio && lpRatio == expectedLpRatio
            && lpUsdtRatio == expectedLpUsdtRatio && lpReceiver == expectedLpReceiver
            && burnRemainder == expectedBurnRemainder, "claim quote changed");
        _claim(mode);
    }

    function _claim(uint8 mode) private {
        require(mode <= 1, "invalid mode");
        require(!claims[msg.sender].claimed, "already claimed");
        uint256 entitlement = claimable[msg.sender];
        require(entitlement > 0, "nothing claimable");
        // claimable 与池余额双重校验，不足则 revert
        require(poolBalance() >= totalAllocated, "pool balance insufficient");

        uint256 payout;
        uint256 remainder; // mode 0 剩余部分
        uint256 lpTokens; // mode 1 入 LP 的代币
        uint256 usdtDue; // mode 1 需支付的 USDT 等值

        if (mode == 0) {
            payout = (entitlement * directRatio) / 100;
            remainder = entitlement - payout;
        } else {
            payout = (entitlement * lpRatio) / 100;
            lpTokens = entitlement - payout;
            // USDT 等值 = 可领额度折算认购单价后的 lpUsdtRatio%
            usdtDue = (entitlement * UNIT_PRICE * lpUsdtRatio) / (TOKENS_PER_SHARE * 100);
        }

        // 先记账（CEI），再转账；任何一步失败整体回滚
        claimable[msg.sender] = 0;
        totalAllocated -= entitlement;
        totalClaimed += payout;
        claims[msg.sender] = ClaimInfo({claimed: true, mode: mode, amount: payout});

        if (mode == 0) {
            if (payout > 0) _safeTransfer(xbt, msg.sender, payout);
            if (remainder > 0 && burnRemainder) {
                _safeTransfer(xbt, BURN_ADDRESS, remainder);
                totalBurned += remainder;
                emit RemainderBurned(msg.sender, remainder);
            }
            // burnRemainder = false 时剩余部分留在池中（变为未分配余额）
        } else {
            // USDT 转账失败或余额不足直接 revert（整体回滚）
            if (usdtDue > 0) _safeTransferFrom(usdt, msg.sender, lpReceiver, usdtDue);
            if (payout > 0) _safeTransfer(xbt, msg.sender, payout);
            if (lpTokens > 0) _safeTransfer(xbt, lpReceiver, lpTokens);
        }

        emit Claimed(msg.sender, mode, payout, remainder, lpTokens, usdtDue);
    }

    /// mode 0 剩余部分处理方式：true 销毁 / false 留池
    function setBurnRemainder(bool burn) external onlyOwner nonReentrant {
        burnRemainder = burn;
        emit BurnRemainderSet(burn);
    }

    /// 比例调整（上限保护：不超过 100%；支出始终按可领额度百分比计算，不会导致池子透支）
    function setDirectRatio(uint256 value) external onlyOwner nonReentrant {
        require(value <= MAX_RATIO, "exceeds max ratio");
        directRatio = value;
        emit RatioUpdated("directRatio", value);
    }

    function setLpRatio(uint256 value) external onlyOwner nonReentrant {
        require(value <= MAX_RATIO, "exceeds max ratio");
        lpRatio = value;
        emit RatioUpdated("lpRatio", value);
    }

    function setLpUsdtRatio(uint256 value) external onlyOwner nonReentrant {
        require(value <= MAX_RATIO, "exceeds max ratio");
        lpUsdtRatio = value;
        emit RatioUpdated("lpUsdtRatio", value);
    }

    function setLpReceiver(address to) external onlyOwner nonReentrant {
        require(to != address(0) && to != address(this), "invalid receiver");
        lpReceiver = to;
        emit LpReceiverSet(to);
    }

    function transferOwnership(address to) external onlyOwner nonReentrant {
        require(to != address(0), "zero address");
        owner = to;
    }

    /* ---------- 迷你 SafeERC20：兼容无返回值的主流 USDT 实现 ---------- */

    function _safeTransfer(IBEP20 token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(abi.encodeWithSelector(token.transfer.selector, to, value));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "token transfer failed");
    }

    function _safeTransferFrom(IBEP20 token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "token transferFrom failed");
    }
}
