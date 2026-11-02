// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBEP20 {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface ISaleClaimPool {
    function token() external view returns (address);
    function sale() external view returns (address);
}

/**
 * 蟹比特 CaBi 认购 / 领取合约（BSC）
 *
 * 认购与资金规则：
 * - 认购：50 USDT / 份，单账户限购 2 份，全局硬顶 20,000 份
 * - 认购款 100% 直接进入收款地址（fundReceiver），合约不拆分、不留存
 * - 每份空投 35000 CaBi；推荐关系绑定后永久不可更改
 * - 直推：下级每认购 1 份上级业绩 +1，累计每满 3 份实时空投 1 份，无限循环
 * - 所有认购及奖励额度均需先手动注入足额CaBi，避免创建无法履约的领取义务
 * - 在任何正额度创建前可一次性绑定CaBiClaimPool，之后认购配额仅由该池结算（用户选择50%直接或70%组LP）
 * - 未绑定的历史模式领取70%代币，30%代币及对应USDT转金库，不调用DEX或铸造LP
 * - 团队梯度奖励：链下核算，在finalize前由owner批量记入领取额度
 * - finalize()仅将未分配代币转入黑洞；已分配未领取额度保留且仍可领取
 */
contract XBTSale {
    IBEP20 public immutable usdt; // USDT（BSC 主网 0x55d398326f99059fF775485246999027B3197955）
    IBEP20 public immutable xbt; // CaBi 代币

    uint256 public immutable UNIT_PRICE; // 50 USDT，按所选USDT精度计算
    uint256 public constant MAX_SHARES_PER_WALLET = 2; // 单账户限购 2 份
    uint256 public constant HARD_CAP = 20_000; // 全局硬顶 20,000 份
    uint256 public constant TOKENS_PER_SHARE = 35000 * 1e18; // 每份空投 35000 CaBi
    uint256 public constant LP_RATIO = 30; // 30%代币及折合认购价30%的USDT转入金库
    uint256 public constant DIRECT_REWARD_EVERY = 3; // 直推每满 3 份空投 1 份
    uint256 public constant REFERRAL_BINDING_VERSION = 1; // 独立绑定接口版本，供DApp显式核验
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public owner;
    address public lpReceiver; // 金库接收地址；收到资产不等于铸造LP
    address public fundReceiver; // 认购款收款地址（100%）
    address public claimPool; // 一次性委托的领取池；0保留历史领取模式

    bool public subscribeLocked; // 认购开关（对应后台锁定）
    bool public finalized; // 是否已结算销毁

    uint256 public globalSold; // 全局已认购份数
    uint256 public reservedTokens; // 已分配未领取的全部CaBi义务
    uint256 private _status = 1;
    bool private _entitlementsCreated;

    mapping(address => uint256) public purchased; // 主动认购份数
    mapping(address => uint256) public rewardShares; // 奖励空投份数（直推 + 团队）
    mapping(address => uint256) public teamRewardShares; // 累计已记账团队奖励；不包含直推奖励
    mapping(address => address) public referrer; // 绑定的上级（永久）
    mapping(address => uint256) public directShares; // 直推业绩（份数）
    mapping(address => uint256) public claimed; // 已结算配额；委托模式记完整配额，池中另记用户实际50%/70%到账，历史模式记70%
    mapping(address => uint256) public lpCredited; // 已转入金库的30%代币

    event Subscribed(address indexed user, uint256 quantity, address indexed referrer);
    event ReferrerBound(address indexed user, address indexed referrer);
    event DirectReward(address indexed referrer, uint256 shares, uint256 directTotal);
    event TeamRewardCredited(address indexed user, uint256 shares);
    event TeamRewardTotalSet(address indexed user, uint256 total, uint256 added);
    event Claimed(address indexed user, uint256 claimable, uint256 lpLocked);
    event Finalized(uint256 burned);
    event SubscribeLocked(bool locked);
    event ClaimPoolSet(address indexed pool);

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
     * @param usdtAddress USDT 合约地址
     * @param xbtAddress  CaBi 代币合约地址
     * @param lpReceiver_ 金库接收地址（不是DEX交易对）
     * @param fundReceiver_ 认购款收款地址（100%）
     */
    constructor(address usdtAddress, address xbtAddress, address lpReceiver_, address fundReceiver_) {
        require(
            usdtAddress != address(0) && xbtAddress != address(0) && lpReceiver_ != address(0) && fundReceiver_ != address(0),
            "zero address"
        );
        require(usdtAddress.code.length > 0 && xbtAddress.code.length > 0 && usdtAddress != xbtAddress, "invalid assets");
        uint8 quoteDecimals = IBEP20(usdtAddress).decimals();
        require(quoteDecimals <= 18 && IBEP20(xbtAddress).decimals() == 18, "unsupported decimals");
        UNIT_PRICE = 50 * 10 ** uint256(quoteDecimals);
        owner = msg.sender;
        usdt = IBEP20(usdtAddress);
        xbt = IBEP20(xbtAddress);
        lpReceiver = lpReceiver_;
        fundReceiver = fundReceiver_;
    }

    function poolBalance() public view returns (uint256) { return xbt.balanceOf(address(this)); }

    /// Actual backing assets: the bound claim pool, or this contract in legacy mode.
    function fundingBalance() public view returns (uint256) {
        return claimPool == address(0) ? poolBalance() : xbt.balanceOf(claimPool);
    }

    function unusedBalance() public view returns (uint256) {
        uint256 balance = poolBalance();
        uint256 required = claimPool == address(0) ? reservedTokens : 0;
        return balance > required ? balance - required : 0;
    }

    /// Fresh deployments only: existing entitlements must never switch accounting modes.
    function setClaimPool(address pool) external onlyOwner nonReentrant {
        require(claimPool == address(0) && !_entitlementsCreated && !finalized, "claim pool cannot change");
        require(pool.code.length > 0 && pool != address(this), "invalid claim pool");
        require(ISaleClaimPool(pool).token() == address(xbt) && ISaleClaimPool(pool).sale() == address(this), "claim pool mismatch");
        claimPool = pool;
        emit ClaimPoolSet(pool);
    }

    /// 空投代币总额度（份数 → 代币）
    function entitlementOf(address user) public view returns (uint256) {
        return (purchased[user] + rewardShares[user]) * TOKENS_PER_SHARE;
    }

    /// Bound pools consume the full entitlement, with payout/burn/LP handled by that pool; legacy settles 70%.
    function claimableOf(address user) public view returns (uint256) {
        uint256 totalClaimable = claimPool == address(0) ? (entitlementOf(user) * (100 - LP_RATIO)) / 100 : entitlementOf(user);
        return totalClaimable > claimed[user] ? totalClaimable - claimed[user] : 0;
    }

    /// 本次领取需向金库支付的USDT：本次处理份额 × 单价 × 30%
    function lpFeeOf(address user) public view returns (uint256) {
        if (claimPool != address(0)) return 0;
        uint256 claimable = claimableOf(user);
        uint256 lpDue = (entitlementOf(user) * LP_RATIO) / 100 - lpCredited[user];
        return ((claimable + lpDue) * UNIT_PRICE * LP_RATIO) / (TOKENS_PER_SHARE * 100);
    }

    /** Bind a referrer without subscribing or transferring assets. No retrospective rewards. */
    function bindReferrer(address referrer_) external nonReentrant {
        require(referrer[msg.sender] == address(0), "referrer already bound");
        _bindReferrer(msg.sender, referrer_);
    }

    function _bindReferrer(address user, address referrer_) private {
        require(referrer_ != address(0) && referrer_ != BURN_ADDRESS && referrer_ != address(this) && referrer_ != address(xbt) && referrer_ != address(usdt) && referrer_ != claimPool, "invalid referrer");
        address cursor = referrer_;
        while (cursor != address(0)) {
            require(cursor != user, "referral cycle");
            cursor = referrer[cursor];
        }
        referrer[user] = referrer_;
        emit ReferrerBound(user, referrer_);
    }

    /**
     * 认购
     * @param quantity 份数（1-2，单账户累计不超过 2）
     * @param referrer_ 已绑定时传0或相同上级；首次认购可同时绑定，DApp需先独立绑定
     * 调用前需先对 USDT 合约 approve 本合约 quantity * 50 USDT
     * 认购款 100% 直接打入收款地址，合约不拆分、不留存
     */
    function subscribe(uint256 quantity, address referrer_) external nonReentrant {
        require(!subscribeLocked && !finalized, "subscribe closed");
        require(quantity >= 1, "min 1 share");
        require(purchased[msg.sender] + quantity <= MAX_SHARES_PER_WALLET, "wallet cap 2 shares");
        require(globalSold + quantity <= HARD_CAP, "hard cap reached");

        uint256 cost = quantity * UNIT_PRICE;
        uint256 allocated = quantity;

        // A separately bound referrer is authoritative; subscription can never overwrite it.
        if (referrer[msg.sender] != address(0)) {
            require(referrer_ == address(0) || referrer_ == referrer[msg.sender], "referrer already bound");
        } else if (purchased[msg.sender] == 0 && referrer_ != address(0)) {
            _bindReferrer(msg.sender, referrer_);
        }

        purchased[msg.sender] += quantity;
        globalSold += quantity;

        // 直推奖励：下级每认购 1 份上级业绩 +1，累计每满 3 份实时空投 1 份，无限循环
        address ref = referrer[msg.sender];
        if (ref != address(0)) {
            uint256 oldDirect = directShares[ref];
            uint256 newDirect = oldDirect + quantity;
            directShares[ref] = newDirect;
            uint256 granted = newDirect / DIRECT_REWARD_EVERY - oldDirect / DIRECT_REWARD_EVERY;
            if (granted > 0) {
                rewardShares[ref] += granted;
                allocated += granted;
                emit DirectReward(ref, granted, newDirect);
            }
        }

        reservedTokens += allocated * TOKENS_PER_SHARE;
        _entitlementsCreated = true;
        require(fundingBalance() >= reservedTokens, "pool balance insufficient");
        _safeTransferFrom(usdt, msg.sender, fundReceiver, cost);
        emit Subscribed(msg.sender, quantity, ref);
    }

    /**
     * 领取：70%CaBi给用户，30%CaBi及对应USDT转入金库。
     * 不调用DEX或铸造LP；finalize之后仍可领取此前已分配额度。
     * 调用前需先对 USDT 合约 approve 本合约 lpFeeOf(自己) 的额度。
     */
    function claim() external nonReentrant {
        _claim();
    }

    /// Reject a wallet confirmation based on stale fee or a changed vault.
    function claimChecked(address expectedLpReceiver, uint256 expectedLpFee) external nonReentrant {
        require(lpReceiver == expectedLpReceiver && lpFeeOf(msg.sender) == expectedLpFee, "claim quote changed");
        _claim();
    }

    function _claim() private {
        require(claimPool == address(0), "claim through bound pool");
        uint256 claimable = claimableOf(msg.sender);
        uint256 lpDue = (entitlementOf(msg.sender) * LP_RATIO) / 100 - lpCredited[msg.sender];
        require(claimable > 0 || lpDue > 0, "nothing to claim");
        require(poolBalance() >= reservedTokens, "pool balance insufficient");
        // 持仓上限由代币合约统一按当前 owner 配置执行。

        uint256 lpFee = ((claimable + lpDue) * UNIT_PRICE * LP_RATIO) / (TOKENS_PER_SHARE * 100);

        claimed[msg.sender] += claimable;
        lpCredited[msg.sender] += lpDue;
        reservedTokens -= claimable + lpDue;

        // 资产直接转入金库；任何一步失败整体回滚，未创建LP凭证。
        if (lpFee > 0) _safeTransferFrom(usdt, msg.sender, lpReceiver, lpFee);
        if (claimable > 0) _safeTransfer(xbt, msg.sender, claimable);
        if (lpDue > 0) _safeTransfer(xbt, lpReceiver, lpDue);

        emit Claimed(msg.sender, claimable, lpDue);
    }

    /// The bound pool atomically consumes an entitlement before its exact payout.
    /// Any payout failure in the outer transaction also rolls back this accounting.
    function consumeClaim(address user, uint256 expectedAmount) external nonReentrant {
        require(claimPool != address(0) && msg.sender == claimPool, "not claim pool");
        uint256 amount = claimableOf(user);
        require(amount > 0 && amount == expectedAmount, "claim quote changed");
        require(fundingBalance() >= reservedTokens, "pool balance insufficient");
        claimed[user] += amount;
        reservedTokens -= amount;
        emit Claimed(user, amount, 0);
    }

    /**
     * 历史/人工增量接口：重复提交会重复追加，不具备幂等性。
     * 同时更新团队累计账本；新后台应使用 batchSetTeamRewardTotals。
     * 团队梯度（极差）由链下核算，仅 finalize 前可记账。
     */
    function batchCreditTeamReward(address[] calldata users, uint256[] calldata shares) external onlyOwner nonReentrant {
        require(!finalized, "finalized");
        require(users.length == shares.length && users.length > 0, "invalid batch");
        uint256 allocated;
        for (uint256 i = 0; i < users.length; i++) {
            require(users[i] != address(0), "zero address");
            teamRewardShares[users[i]] += shares[i];
            rewardShares[users[i]] += shares[i];
            allocated += shares[i];
            emit TeamRewardCredited(users[i], shares[i]);
        }
        reservedTokens += allocated * TOKENS_PER_SHARE;
        if (allocated > 0) _entitlementsCreated = true;
        require(fundingBalance() >= reservedTokens, "pool balance insufficient");
    }

    /**
     * 按地址设置累计团队应发整数份数，仅追加尚未记账的差额。
     * 累计值不得下降；相同累计值不会重复发放，全批无新增时拒绝。
     * 直推奖励不属于团队累计值，不能把 rewardShares 当作本接口的累计基数。
     */
    function batchSetTeamRewardTotals(address[] calldata users, uint256[] calldata totals) external onlyOwner nonReentrant {
        require(!finalized, "finalized");
        require(users.length == totals.length && users.length > 0 && users.length <= 100, "invalid batch");
        uint256 allocated;
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            require(user != address(0), "zero address");
            uint256 previous = teamRewardShares[user];
            uint256 total = totals[i];
            require(total >= previous, "team total cannot decrease");
            uint256 added = total - previous;
            if (added > 0) {
                teamRewardShares[user] = total;
                rewardShares[user] += added;
                allocated += added;
            }
            emit TeamRewardTotalSet(user, total, added);
        }
        require(allocated > 0, "no new team reward");
        reservedTokens += allocated * TOKENS_PER_SHARE;
        _entitlementsCreated = true;
        require(fundingBalance() >= reservedTokens, "pool balance insufficient");
    }

    /**
     * 结算：认购售罄或 owner 关闭后调用
     * 仅未分配余额转入黑洞，不得消耗任何已分配未领取的义务。
     */
    function finalize() external onlyOwner nonReentrant {
        require(!finalized, "finalized");
        require(globalSold >= HARD_CAP || subscribeLocked, "sale still open");
        uint256 balance = poolBalance();
        require(fundingBalance() >= reservedTokens, "pool balance insufficient");
        finalized = true;
        subscribeLocked = true;
        // Delegated pool assets and outstanding 100% entitlements remain untouched.
        uint256 remaining = claimPool == address(0) ? balance - reservedTokens : balance;
        if (remaining > 0) {
            _safeTransfer(xbt, BURN_ADDRESS, remaining);
        }
        emit Finalized(remaining);
    }

    function setSubscribeLocked(bool locked) external onlyOwner nonReentrant {
        require(!finalized || locked, "finalized");
        subscribeLocked = locked;
        emit SubscribeLocked(locked);
    }

    function setLpReceiver(address to) external onlyOwner nonReentrant {
        require(to != address(0) && to != address(this), "invalid receiver");
        lpReceiver = to;
    }

    function setFundReceiver(address to) external onlyOwner nonReentrant {
        require(to != address(0) && to != address(this), "invalid receiver");
        fundReceiver = to;
    }

    function transferOwnership(address to) external onlyOwner nonReentrant {
        require(to != address(0), "zero address");
        owner = to;
    }

    function _safeTransfer(IBEP20 token, address to, uint256 amount) private {
        (bool ok, bytes memory result) = address(token).call(abi.encodeWithSelector(token.transfer.selector, to, amount));
        require(ok && (result.length == 0 || abi.decode(result, (bool))), "token transfer failed");
    }

    function _safeTransferFrom(IBEP20 token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory result) = address(token).call(abi.encodeWithSelector(token.transferFrom.selector, from, to, amount));
        require(ok && (result.length == 0 || abi.decode(result, (bool))), "token transferFrom failed");
    }
}
