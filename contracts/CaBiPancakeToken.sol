// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICaBiQuote {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}
interface ICaBiFactory { function getPair(address tokenA, address tokenB) external view returns (address); }
interface ICaBiPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function factory() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function sync() external;
}
interface ICaBiRouter {
    function factory() external view returns (address);
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory);
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256 deadline) external;
}

/// V2 pairs reject output to either token contract. This immutable, token-only
/// receiver collects quote output and immediately forwards the exact swap delta.
contract CaBiTaxReceiver {
    address public immutable token = msg.sender;
    function release(address asset, uint256 amount) external {
        require(msg.sender == token, "only token");
        (bool ok, bytes memory data) = asset.call(abi.encodeWithSelector(ICaBiQuote.transfer.selector, token, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "quote forwarding failed");
    }
}

/**
 * CaBi for direct V2 router swaps. All supply is minted once to ownerAddress.
 * BUY: 3% of output CaBi accrues here; SELL: 3% CaBi goes to dead; wallet: 0%.
 * Accrued CaBi is sold later for USDT, split 2:1 by default, not 3% of buy USDT.
 * No swapback occurs during pair output (the V2 pair is locked then).
 * Opportunistic sell-time swapback is bounded and failure-isolated. An explicit
 * processTax call is also available. USDT recipient failures retain pull credits.
 * Router quotes are spot quotes, not oracles; configured slippage bounds do not
 * eliminate MEV. Only the single configured CaBi/USDT V2 pair is covered.
 * Set the created pair's holding exemption, then add initial liquidity before
 * configureTrading for untaxed initial liquidity. After
 * configuration, direct adds are sells and direct removals are buys for taxation.
 * There is no arbitrary trading-tax exemption, including for owner/admins.
 * Every eight hours a permissionless burnPool transaction can move 1% of the
 * current configured pair's CaBi balance to dead and sync reserves. The quote
 * asset and LP supply are untouched. A keeper must send transactions on schedule.
 * There is no catch-up burn for missed intervals and no transfer-time pool burn.
 */
contract CaBiPancakeToken {
    string public constant name = "CaBi";
    string public constant symbol = "CaBi";
    uint8 public constant decimals = 18;
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;
    uint256 public constant BUY_FEE_BPS = 300;
    uint256 public constant SELL_FEE_BPS = 300;
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant POOL_BURN_INTERVAL = 8 hours;
    uint256 public constant POOL_BURN_BPS = 100;
    uint256 public constant MAX_SWAP_AMOUNT = 100_000 * 1e18;
    uint256 private constant AUTO_SWAP_GAS = 650_000;
    uint256 private constant SELL_GAS_RESERVE = 120_000;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public owner;
    CaBiTaxReceiver public immutable taxReceiver;
    address public pendingOwner;
    address public dexRouter;
    address public usdt;
    address public tradingPair;
    // Retained for consumers of the legacy read ABI; there is no gateway here.
    address public constant tradingGateway = address(0);
    address public dividendReceiver1;
    address public dividendReceiver2;
    uint256 public dividendRate1Bps = 200;
    uint256 public dividendRate2Bps = 100;
    uint256 public maxWalletAmount = 200_000 * 1e18;
    uint256 public swapThreshold = 1_000 * 1e18;
    uint256 public maxSwapAmount = 10_000 * 1e18;
    uint256 public swapSlippageBps = 500;
    bool public autoSwapEnabled = true;
    bool public processing;
    uint256 public totalPendingDividends;
    uint256 public lastPoolBurnTime;
    uint256 public totalPoolBurned;
    uint256 private _status = 1;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public isMaxWalletExempt;
    mapping(address => uint256) public pendingDividends;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TradingConfigured(address indexed router, address indexed quote, address indexed pair);
    event BuyTaxCollected(address indexed buyer, uint256 grossAmount, uint256 taxAmount);
    event SellFeeCharged(address indexed seller, uint256 grossAmount, uint256 burnedAmount);
    event Burn(address indexed from, uint256 value);
    event PoolBurned(address indexed pair, uint256 amount, uint256 poolBalanceBefore, uint256 executedAt);
    event MaxWalletAmountUpdated(uint256 previousAmount, uint256 newAmount);
    event MaxWalletExemptionSet(address indexed account, bool exempt);
    event DividendRatesUpdated(uint256 rate1Bps, uint256 rate2Bps);
    event DividendReceiversUpdated(address indexed receiver1, address indexed receiver2);
    event SwapSettingsUpdated(uint256 threshold, uint256 maxAmount, uint256 slippageBps, bool enabled);
    event TaxProcessed(uint256 tokensSold, uint256 usdtReceived, address indexed receiver1, address indexed receiver2, uint256 amount1, uint256 amount2);
    event TaxProcessingDeferred(uint256 attemptedTokens);
    event DividendPaid(address indexed receiver, address indexed recipient, uint256 amount);
    event DividendPaymentDeferred(address indexed receiver, uint256 pendingAmount);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier nonReentrant() { require(_status == 1 && !processing, "operation active"); _status = 2; _; _status = 1; }
    modifier onlySelf() { require(msg.sender == address(this), "only self"); _; }

    constructor(address receiver1, address receiver2, address ownerAddress) {
        require(ownerAddress != address(0) && ownerAddress != address(this), "invalid owner");
        owner = ownerAddress;
        taxReceiver = new CaBiTaxReceiver();
        _setReceivers(receiver1, receiver2);
        _setExempt(ownerAddress, true);
        _setExempt(address(this), true);
        _setExempt(BURN_ADDRESS, true);
        balanceOf[ownerAddress] = TOTAL_SUPPLY;
        emit Transfer(address(0), ownerAddress, TOTAL_SUPPLY);
        emit OwnershipTransferred(address(0), ownerAddress);
    }
    function totalSupply() external pure returns (uint256) { return TOTAL_SUPPLY; }
    function getOwner() external view returns (address) { return owner; }
    function pair() external view returns (address) { return tradingPair; }
    function taxTokenBalance() external view returns (uint256) { return balanceOf[address(this)]; }
    function transfer(address to, uint256 amount) external returns (bool) { _transfer(msg.sender, to, amount); return true; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; emit Approval(msg.sender, spender, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance exceeded");
        if (allowed != type(uint256).max) { allowance[from][msg.sender] = allowed - amount; emit Approval(from, msg.sender, allowed - amount); }
        _transfer(from, to, amount);
        return true;
    }
    function burn(uint256 amount) external { _transfer(msg.sender, BURN_ADDRESS, amount); emit Burn(msg.sender, amount); }

    /// Configure once. The V2 pair must already exist in this router's factory.
    function configureTrading(address router, address quote, address pairAddress) external onlyOwner nonReentrant {
        require(tradingPair == address(0), "trading already configured");
        require(router.code.length > 0 && quote.code.length > 0 && pairAddress.code.length > 0, "invalid contracts");
        require(quote != address(this) && ICaBiQuote(quote).decimals() <= 18, "invalid quote");
        address factory = ICaBiRouter(router).factory();
        require(factory.code.length > 0 && ICaBiPair(pairAddress).factory() == factory, "wrong factory");
        require(ICaBiFactory(factory).getPair(address(this), quote) == pairAddress, "wrong factory pair");
        address first = ICaBiPair(pairAddress).token0();
        address second = ICaBiPair(pairAddress).token1();
        require((first == address(this) && second == quote) || (first == quote && second == address(this)), "wrong assets");
        require(dividendReceiver1 != router && dividendReceiver2 != router && dividendReceiver1 != pairAddress && dividendReceiver2 != pairAddress && dividendReceiver1 != quote && dividendReceiver2 != quote, "invalid receivers");
        dexRouter = router; usdt = quote; tradingPair = pairAddress;
        lastPoolBurnTime = block.timestamp;
        _setExempt(pairAddress, true);
        _setExempt(router, true);
        emit TradingConfigured(router, quote, pairAddress);
    }
    function nextPoolBurnTime() public view returns (uint256) {
        return tradingPair == address(0) ? 0 : lastPoolBurnTime + POOL_BURN_INTERVAL;
    }
    /// Only clean, liquid reserves can be burned. Pending deposits must be
    /// minted/synced first; the burn must never absorb somebody else's deposit.
    function previewPoolBurn() external view returns (uint256 amount, uint256 nextBurnAt, bool due) {
        address pool = tradingPair;
        if (pool == address(0)) return (0, 0, false);
        nextBurnAt = nextPoolBurnTime();
        uint256 tokenBalance = balanceOf[pool];
        amount = tokenBalance * POOL_BURN_BPS / FEE_DENOMINATOR;
        (uint112 reserve0, uint112 reserve1,) = ICaBiPair(pool).getReserves();
        bool tokenFirst = ICaBiPair(pool).token0() == address(this);
        uint256 tokenReserve = tokenFirst ? reserve0 : reserve1;
        uint256 quoteReserve = tokenFirst ? reserve1 : reserve0;
        due = !processing && _status == 1 && block.timestamp >= nextBurnAt && amount > 0
            && tokenReserve > 0 && quoteReserve > 0 && tokenBalance == tokenReserve
            && ICaBiQuote(usdt).balanceOf(pool) == quoteReserve;
    }
    /// Anyone may execute one due interval. No allowance, swap, quote transfer,
    /// LP withdrawal or extra trading tax. Failed sync reverts the entire burn.
    function burnPool() external nonReentrant returns (uint256 amount) {
        address pool = tradingPair;
        require(pool != address(0), "trading not configured");
        require(block.timestamp >= nextPoolBurnTime(), "pool burn not due");
        (uint112 reserve0, uint112 reserve1,) = ICaBiPair(pool).getReserves();
        bool tokenFirst = ICaBiPair(pool).token0() == address(this);
        uint256 tokenReserve = tokenFirst ? reserve0 : reserve1;
        uint256 quoteReserve = tokenFirst ? reserve1 : reserve0;
        uint256 tokenBefore = balanceOf[pool];
        require(tokenReserve > 0 && quoteReserve > 0, "no liquidity");
        require(tokenBefore == tokenReserve && ICaBiQuote(usdt).balanceOf(pool) == quoteReserve, "unsynced pool");
        amount = tokenBefore * POOL_BURN_BPS / FEE_DENOMINATOR;
        require(amount > 0, "pool burn rounds to zero");
        // Restart from actual execution: overdue periods never drain the pool
        // in one call, nor allow repeated catch-up calls at the same timestamp.
        lastPoolBurnTime = block.timestamp;
        totalPoolBurned += amount;
        _move(pool, BURN_ADDRESS, amount);
        ICaBiPair(pool).sync();
        (reserve0, reserve1,) = ICaBiPair(pool).getReserves();
        require((tokenFirst ? reserve0 : reserve1) == tokenBefore - amount
            && (tokenFirst ? reserve1 : reserve0) == quoteReserve
            && balanceOf[pool] == tokenBefore - amount
            && ICaBiQuote(usdt).balanceOf(pool) == quoteReserve, "invalid pool burn sync");
        emit Burn(pool, amount);
        emit PoolBurned(pool, amount, tokenBefore, block.timestamp);
    }
    function setMaxWalletAmount(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0 && amount <= TOTAL_SUPPLY, "invalid wallet limit");
        emit MaxWalletAmountUpdated(maxWalletAmount, amount); maxWalletAmount = amount;
    }
    /// Holding exemption never exempts trading tax.
    function setMaxWalletExempt(address account, bool exempt) external onlyOwner nonReentrant {
        require(account != address(0), "zero address");
        if (!exempt) require(account != address(this) && account != BURN_ADDRESS && account != tradingPair && account != dexRouter, "system exemption required");
        _setExempt(account, exempt);
    }
    function setDividendReceivers(address receiver1, address receiver2) external onlyOwner nonReentrant { _setReceivers(receiver1, receiver2); }
    /// Shares of the fixed 300 bps token buy tax. Applies when tax is processed.
    function setDividendRates(uint256 first, uint256 second) external onlyOwner nonReentrant {
        require(first + second == BUY_FEE_BPS && first <= BUY_FEE_BPS && second <= BUY_FEE_BPS, "rates must total 300");
        dividendRate1Bps = first; dividendRate2Bps = second; emit DividendRatesUpdated(first, second);
    }
    function setSwapSettings(uint256 threshold, uint256 maxAmount, uint256 slippageBps, bool enabled) external onlyOwner nonReentrant {
        require(threshold > 0 && threshold <= maxAmount && maxAmount <= MAX_SWAP_AMOUNT, "invalid swap bounds");
        require(slippageBps <= 1000, "slippage above 10 percent");
        swapThreshold = threshold; maxSwapAmount = maxAmount; swapSlippageBps = slippageBps; autoSwapEnabled = enabled;
        emit SwapSettingsUpdated(threshold, maxAmount, slippageBps, enabled);
    }
    function transferOwnership(address next) external onlyOwner nonReentrant {
        require(next != address(0) && next != address(this), "invalid owner");
        pendingOwner = next; emit OwnershipTransferStarted(owner, next);
    }
    function acceptOwnership() external nonReentrant {
        require(msg.sender == pendingOwner, "not pending owner");
        address previous = owner; owner = msg.sender; pendingOwner = address(0);
        // Ownership does not silently change holding exemptions or tax treatment.
        emit OwnershipTransferred(previous, msg.sender);
    }

    function previewTaxSwap(uint256 amount) public view returns (uint256 expectedUsdt, uint256 protectedMinimum) {
        require(tradingPair != address(0) && amount > 0 && amount <= maxSwapAmount, "invalid tax swap");
        uint256[] memory quoted = ICaBiRouter(dexRouter).getAmountsOut(amount, _path());
        require(quoted.length == 2 && quoted[1] > 0, "no liquidity");
        expectedUsdt = quoted[1];
        protectedMinimum = expectedUsdt * (FEE_DENOMINATOR - swapSlippageBps) / FEE_DENOMINATOR;
        if (protectedMinimum == 0) protectedMinimum = 1;
    }
    /// Permissionless execution with caller minOut AND on-chain quote bound.
    function processTax(uint256 amount, uint256 minUsdtOut, uint256 deadline) external nonReentrant returns (uint256 received) {
        (, uint256 floor) = previewTaxSwap(amount);
        require(minUsdtOut >= floor && deadline >= block.timestamp, "invalid swap protection");
        received = _swapTax(amount, minUsdtOut, deadline);
    }
    /// Isolated self-call: any quote/router failure rolls back only swapback.
    function autoProcessTax(uint256 amount) external onlySelf returns (uint256 received) {
        require(_status == 1 && !processing, "operation active");
        (, uint256 floor) = previewTaxSwap(amount);
        received = _swapTax(amount, floor, block.timestamp + 120);
    }
    /// Receiver can redirect its own pending USDT credit if its address rejects payments.
    function claimDividend(address recipient) external nonReentrant {
        require(recipient != address(0) && recipient != address(this) && recipient != tradingPair, "invalid recipient");
        uint256 amount = pendingDividends[msg.sender];
        require(amount > 0, "nothing pending");
        _payDividend(msg.sender, recipient, amount);
    }
    function payDividend(address receiver) external onlySelf {
        _payDividend(receiver, receiver, pendingDividends[receiver]);
    }

    function _swapTax(uint256 amount, uint256 minOut, uint256 deadline) private returns (uint256 received) {
        require(!processing && amount > 0 && amount <= maxSwapAmount && amount <= balanceOf[address(this)], "invalid tax amount");
        processing = true;
        uint256 beforeUsdt = ICaBiQuote(usdt).balanceOf(address(this));
        uint256 beforeReceiver = ICaBiQuote(usdt).balanceOf(address(taxReceiver));
        require(beforeUsdt >= totalPendingDividends, "dividend balance deficit");
        allowance[address(this)][dexRouter] = amount;
        emit Approval(address(this), dexRouter, amount);
        ICaBiRouter(dexRouter).swapExactTokensForTokensSupportingFeeOnTransferTokens(amount, minOut, _path(), address(taxReceiver), deadline);
        allowance[address(this)][dexRouter] = 0;
        emit Approval(address(this), dexRouter, 0);
        uint256 receiverDelta = ICaBiQuote(usdt).balanceOf(address(taxReceiver)) - beforeReceiver;
        taxReceiver.release(usdt, receiverDelta);
        received = ICaBiQuote(usdt).balanceOf(address(this)) - beforeUsdt;
        require(received > 0 && received >= minOut, "insufficient tax output");
        address first = dividendReceiver1;
        address second = dividendReceiver2;
        uint256 amount1 = received * dividendRate1Bps / BUY_FEE_BPS;
        uint256 amount2 = received - amount1;
        pendingDividends[first] += amount1; pendingDividends[second] += amount2; totalPendingDividends += received;
        emit TaxProcessed(amount, received, first, second, amount1, amount2);
        _attemptPayout(first); _attemptPayout(second);
        processing = false;
    }
    function _attemptPayout(address receiver) private {
        if (pendingDividends[receiver] == 0) return;
        // A separate subcall rolls back even a nonstandard token that transfers then returns false.
        try this.payDividend{gas: 70_000}(receiver) {} catch { emit DividendPaymentDeferred(receiver, pendingDividends[receiver]); }
    }
    function _payDividend(address receiver, address recipient, uint256 amount) private {
        if (amount == 0) return;
        pendingDividends[receiver] -= amount; totalPendingDividends -= amount;
        (bool ok, bytes memory data) = usdt.call(abi.encodeWithSelector(ICaBiQuote.transfer.selector, recipient, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "USDT payment failed");
        emit DividendPaid(receiver, recipient, amount);
    }
    function _transfer(address from, address to, uint256 amount) private {
        require(to != address(0), "zero address");
        require(balanceOf[from] >= amount, "balance not enough");
        if (processing) {
            require(from == address(this) && to == tradingPair && msg.sender == dexRouter, "processing transfer forbidden");
            _move(from, to, amount);
            return;
        }
        // Pair output is never allowed to initiate swapback while the pair is locked.
        if (amount > 0 && autoSwapEnabled && tradingPair != address(0) && to == tradingPair && from != tradingPair && from != address(this) && balanceOf[address(this)] >= swapThreshold) {
            uint256 accrued = balanceOf[address(this)];
            uint256 amountToSwap = accrued < maxSwapAmount ? accrued : maxSwapAmount;
            uint256 availableGas = gasleft();
            if (availableGas > SELL_GAS_RESERVE + 100_000) {
                uint256 swapGas = availableGas - SELL_GAS_RESERVE;
                if (swapGas > AUTO_SWAP_GAS) swapGas = AUTO_SWAP_GAS;
                try this.autoProcessTax{gas: swapGas}(amountToSwap) {} catch { emit TaxProcessingDeferred(amountToSwap); }
            }
        }
        bool buy = tradingPair != address(0) && from == tradingPair;
        bool sell = tradingPair != address(0) && to == tradingPair;
        uint256 fee = (buy || sell) ? amount * (buy ? BUY_FEE_BPS : SELL_FEE_BPS) / FEE_DENOMINATOR : 0;
        uint256 net = amount - fee;
        if (from != to && net > 0 && !isMaxWalletExempt[to]) require(balanceOf[to] + net <= maxWalletAmount, "max wallet exceeded");
        if (fee > 0) _move(from, buy ? address(this) : BURN_ADDRESS, fee);
        _move(from, to, net);
        if (buy) emit BuyTaxCollected(to, amount, fee);
        else if (sell) { emit SellFeeCharged(from, amount, fee); if (fee > 0) emit Burn(from, fee); }
    }
    function _move(address from, address to, uint256 amount) private {
        balanceOf[from] -= amount; balanceOf[to] += amount; emit Transfer(from, to, amount);
    }
    function _path() private view returns (address[] memory path) { path = new address[](2); path[0] = address(this); path[1] = usdt; }
    function _setExempt(address account, bool exempt) private { isMaxWalletExempt[account] = exempt; emit MaxWalletExemptionSet(account, exempt); }
    function _setReceivers(address first, address second) private {
        require(first != address(0) && second != address(0) && first != second && first != address(this) && second != address(this) && first != address(taxReceiver) && second != address(taxReceiver) && first != BURN_ADDRESS && second != BURN_ADDRESS, "invalid receivers");
        if (tradingPair != address(0)) require(first != dexRouter && second != dexRouter && first != usdt && second != usdt && first != tradingPair && second != tradingPair, "invalid receivers");
        dividendReceiver1 = first; dividendReceiver2 = second; emit DividendReceiversUpdated(first, second);
    }
}

