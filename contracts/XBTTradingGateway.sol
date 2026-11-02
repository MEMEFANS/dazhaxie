// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IXBTGatewayAsset {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IXBTGatewayToken {
    function tradingGateway() external view returns (address);
}

interface IXBTGatewayFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IXBTGatewayRouter {
    function factory() external view returns (address);
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);
}

/**
 * Exact-input USDT trading entry for one configured CaBi/USDT V2 pair.
 * Buying splits 3% of the caller's gross USDT between two dividend receivers
 * (2% / 1% initially) and swaps the remaining 97%. The owner can change the
 * receivers and their split while the total buy fee stays fixed at 3%.
 * Selling uses XBTToken's 3% token-to-dead fee when tokens enter the pair.
 *
 * XBTToken must be configured with this gateway before use. Direct buys from a
 * standard DEX UI are not supported by that pair: purchases must use buy().
 * Liquidity changes use these wrappers to keep liquidity distinct from trades.
 * Receiving the USDT fee does not itself distribute dividends to holders.
 */
contract XBTTradingGateway {
    uint256 public constant BUY_FEE_BPS = 300;
    uint256 public constant FEE_DENOMINATOR = 10_000;

    address public immutable token;
    address public immutable usdt;
    address public immutable dexRouter;
    address public immutable pair;
    address public owner;
    address public dividendReceiver1;
    address public dividendReceiver2;
    uint256 public dividendRate1Bps = 200;
    uint256 public dividendRate2Bps = 100;

    enum Operation { None, Buy, Sell, AddLiquidity, RemoveLiquidity }
    Operation private _operation;
    uint256 private _status = 1;

    struct LiquidityRequest {
        uint256 xbtDesired;
        uint256 usdtDesired;
        uint256 xbtMin;
        uint256 usdtMin;
        address recipient;
        uint256 deadline;
    }

    struct RemovalRequest {
        uint256 liquidity;
        uint256 xbtMin;
        uint256 usdtMin;
        address recipient;
        uint256 deadline;
    }

    event BuyExecuted(address indexed buyer, address indexed recipient, uint256 grossUsdt, uint256 dividendUsdt, uint256 xbtOut);
    event DividendsPaid(address indexed buyer, address indexed receiver1, address indexed receiver2, uint256 amount1, uint256 amount2);
    event DividendReceiversUpdated(address indexed receiver1, address indexed receiver2);
    event DividendRatesUpdated(uint256 receiver1Bps, uint256 receiver2Bps);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SellExecuted(address indexed seller, address indexed recipient, uint256 grossXbt, uint256 usdtOut);
    event LiquidityAdded(address indexed provider, address indexed recipient, uint256 xbtAdded, uint256 usdtAdded, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, address indexed recipient, uint256 liquidity, uint256 xbtOut, uint256 usdtOut);

    modifier nonReentrant() {
        require(_status == 1, "operation active");
        _status = 2;
        _;
        _status = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(
        address tokenAddress,
        address usdtAddress,
        address dexRouterAddress,
        address dividendReceiver1_,
        address dividendReceiver2_,
        address ownerAddress
    ) {
        require(tokenAddress.code.length > 0 && usdtAddress.code.length > 0 && dexRouterAddress.code.length > 0, "invalid contract");
        require(tokenAddress != usdtAddress, "identical assets");
        require(ownerAddress != address(0) && ownerAddress != address(this), "invalid owner");
        token = tokenAddress;
        usdt = usdtAddress;
        dexRouter = dexRouterAddress;
        address factory = IXBTGatewayRouter(dexRouterAddress).factory();
        require(factory.code.length > 0, "invalid factory");
        address pairAddress = IXBTGatewayFactory(factory).getPair(tokenAddress, usdtAddress);
        require(pairAddress.code.length > 0, "create pair first");
        pair = pairAddress;
        owner = ownerAddress;
        emit OwnershipTransferred(address(0), ownerAddress);
        _setDividendReceivers(dividendReceiver1_, dividendReceiver2_);
        emit DividendRatesUpdated(dividendRate1Bps, dividendRate2Bps);
    }

    /// Updates fee receivers without changing the total buy fee or the split.
    function setDividendReceivers(address receiver1, address receiver2) external onlyOwner nonReentrant {
        _setDividendReceivers(receiver1, receiver2);
    }

    /// Rates are fractions of the gross USDT payment: 200 = 2%, 100 = 1%.
    /// Both rates must add up to the fixed 300-bps (3%) buy fee.
    function setDividendRates(uint256 receiver1Bps, uint256 receiver2Bps) external onlyOwner nonReentrant {
        require(receiver1Bps <= BUY_FEE_BPS && receiver2Bps <= BUY_FEE_BPS, "invalid dividend rate");
        require(receiver1Bps + receiver2Bps == BUY_FEE_BPS, "dividend rates must total 300");
        dividendRate1Bps = receiver1Bps;
        dividendRate2Bps = receiver2Bps;
        emit DividendRatesUpdated(receiver1Bps, receiver2Bps);
    }

    /// Transfers this gateway's administration, independently of the token owner.
    function transferOwnership(address newOwner) external onlyOwner nonReentrant {
        require(newOwner != address(0) && newOwner != address(this), "invalid owner");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    /// Token hook: pair output is received only during an active buy/removal.
    function receivingPairTokens() external view returns (bool) {
        return _operation == Operation.Buy || _operation == Operation.RemoveLiquidity;
    }

    /// Token hook: an active addLiquidity transfer is not a sell.
    function addingLiquidity() external view returns (bool) {
        return _operation == Operation.AddLiquidity;
    }

    /// Fees round down to the smallest USDT unit; all remaining units are swapped.
    function previewBuy(uint256 grossUsdt) public pure returns (uint256 dividendUsdt, uint256 swapUsdt) {
        dividendUsdt = (grossUsdt * BUY_FEE_BPS) / FEE_DENOMINATOR;
        swapUsdt = grossUsdt - dividendUsdt;
    }

    /// Receiver 2 receives any rounding remainder so the split equals the total fee.
    function previewDividendSplit(uint256 grossUsdt) public view returns (uint256 amount1, uint256 amount2) {
        (uint256 dividendUsdt,) = previewBuy(grossUsdt);
        amount1 = (grossUsdt * dividendRate1Bps) / FEE_DENOMINATOR;
        amount2 = dividendUsdt - amount1;
    }

    function buy(uint256 grossUsdt, uint256 minXbtOut, address recipient, uint256 deadline)
        external nonReentrant returns (uint256 xbtOut)
    {
        _checkOperation(recipient, deadline);
        require(grossUsdt > 0, "zero amount");
        _pullExact(usdt, grossUsdt);
        (uint256 dividendUsdt, uint256 swapUsdt) = previewBuy(grossUsdt);
        _distributeDividends(grossUsdt);
        uint256 beforeXbt = _balance(token);
        _approveExact(usdt, dexRouter, swapUsdt);
        _operation = Operation.Buy;
        IXBTGatewayRouter(dexRouter).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            swapUsdt, minXbtOut, _path(usdt, token), address(this), deadline
        );
        _operation = Operation.None;
        _approveExact(usdt, dexRouter, 0);
        xbtOut = _balance(token) - beforeXbt;
        require(xbtOut > 0 && xbtOut >= minXbtOut, "insufficient CaBi output");
        _safeTransfer(token, recipient, xbtOut);
        emit BuyExecuted(msg.sender, recipient, grossUsdt, dividendUsdt, xbtOut);
    }

    function sell(uint256 grossXbt, uint256 minUsdtOut, address recipient, uint256 deadline)
        external nonReentrant returns (uint256 usdtOut)
    {
        _checkOperation(recipient, deadline);
        require(grossXbt > 0, "zero amount");
        _pullExact(token, grossXbt);
        uint256 beforeUsdt = _balance(usdt);
        _approveExact(token, dexRouter, grossXbt);
        _operation = Operation.Sell;
        IXBTGatewayRouter(dexRouter).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            grossXbt, minUsdtOut, _path(token, usdt), address(this), deadline
        );
        _operation = Operation.None;
        _approveExact(token, dexRouter, 0);
        usdtOut = _balance(usdt) - beforeUsdt;
        require(usdtOut > 0 && usdtOut >= minUsdtOut, "insufficient USDT output");
        _safeTransfer(usdt, recipient, usdtOut);
        emit SellExecuted(msg.sender, recipient, grossXbt, usdtOut);
    }

    function addLiquidity(
        uint256 xbtDesired,
        uint256 usdtDesired,
        uint256 xbtMin,
        uint256 usdtMin,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 xbtAdded, uint256 usdtAdded, uint256 liquidity) {
        return _addLiquidity(LiquidityRequest(xbtDesired, usdtDesired, xbtMin, usdtMin, recipient, deadline));
    }

    function _addLiquidity(LiquidityRequest memory request)
        private returns (uint256 xbtAdded, uint256 usdtAdded, uint256 liquidity)
    {
        _checkOperation(request.recipient, request.deadline);
        require(request.xbtDesired > 0 && request.usdtDesired > 0, "zero amount");
        uint256 beforeXbt = _balance(token);
        uint256 beforeUsdt = _balance(usdt);
        _pullExact(token, request.xbtDesired);
        _pullExact(usdt, request.usdtDesired);
        _approveExact(token, dexRouter, request.xbtDesired);
        _approveExact(usdt, dexRouter, request.usdtDesired);
        _operation = Operation.AddLiquidity;
        (xbtAdded, usdtAdded, liquidity) = IXBTGatewayRouter(dexRouter).addLiquidity(
            token, usdt, request.xbtDesired, request.usdtDesired, request.xbtMin, request.usdtMin,
            request.recipient, request.deadline
        );
        _operation = Operation.None;
        _approveExact(token, dexRouter, 0);
        _approveExact(usdt, dexRouter, 0);
        _refund(token, beforeXbt);
        _refund(usdt, beforeUsdt);
        emit LiquidityAdded(msg.sender, request.recipient, xbtAdded, usdtAdded, liquidity);
    }

    function removeLiquidity(uint256 liquidity, uint256 xbtMin, uint256 usdtMin, address recipient, uint256 deadline)
        external nonReentrant returns (uint256 xbtOut, uint256 usdtOut)
    {
        return _removeLiquidity(RemovalRequest(liquidity, xbtMin, usdtMin, recipient, deadline));
    }

    function _removeLiquidity(RemovalRequest memory request) private returns (uint256 xbtOut, uint256 usdtOut) {
        _checkOperation(request.recipient, request.deadline);
        require(request.liquidity > 0, "zero liquidity");
        uint256 beforeXbt = _balance(token);
        uint256 beforeUsdt = _balance(usdt);
        _pullExact(pair, request.liquidity);
        _approveExact(pair, dexRouter, request.liquidity);
        _operation = Operation.RemoveLiquidity;
        IXBTGatewayRouter(dexRouter).removeLiquidity(
            token, usdt, request.liquidity, request.xbtMin, request.usdtMin, address(this), request.deadline
        );
        _operation = Operation.None;
        _approveExact(pair, dexRouter, 0);
        xbtOut = _balance(token) - beforeXbt;
        usdtOut = _balance(usdt) - beforeUsdt;
        require(xbtOut >= request.xbtMin && usdtOut >= request.usdtMin, "insufficient liquidity output");
        _safeTransfer(token, request.recipient, xbtOut);
        _safeTransfer(usdt, request.recipient, usdtOut);
        emit LiquidityRemoved(msg.sender, request.recipient, request.liquidity, xbtOut, usdtOut);
    }

    function _setDividendReceivers(address receiver1, address receiver2) private {
        _validateRecipient(receiver1);
        _validateRecipient(receiver2);
        require(receiver1 != receiver2, "identical dividend receivers");
        address factory = IXBTGatewayRouter(dexRouter).factory();
        require(receiver1 != dexRouter && receiver1 != factory && receiver2 != dexRouter && receiver2 != factory,
            "invalid dividend receiver");
        dividendReceiver1 = receiver1;
        dividendReceiver2 = receiver2;
        emit DividendReceiversUpdated(receiver1, receiver2);
    }

    function _distributeDividends(uint256 grossUsdt) private {
        (uint256 amount1, uint256 amount2) = previewDividendSplit(grossUsdt);
        address receiver1 = dividendReceiver1;
        address receiver2 = dividendReceiver2;
        if (amount1 > 0) _safeTransfer(usdt, receiver1, amount1);
        if (amount2 > 0) _safeTransfer(usdt, receiver2, amount2);
        emit DividendsPaid(msg.sender, receiver1, receiver2, amount1, amount2);
    }

    function _checkOperation(address recipient, uint256 deadline) private view {
        require(IXBTGatewayToken(token).tradingGateway() == address(this), "configure token gateway first");
        require(deadline >= block.timestamp, "expired");
        _validateRecipient(recipient);
    }

    function _validateRecipient(address recipient) private view {
        require(
            recipient != address(0) && recipient != address(this) && recipient != token && recipient != usdt && recipient != pair,
            "invalid recipient"
        );
    }

    function _path(address from, address to) private pure returns (address[] memory path) {
        path = new address[](2);
        path[0] = from;
        path[1] = to;
    }

    function _balance(address asset) private view returns (uint256) {
        return IXBTGatewayAsset(asset).balanceOf(address(this));
    }

    function _pullExact(address asset, uint256 amount) private {
        uint256 beforeBalance = _balance(asset);
        _callOptionalReturn(asset, abi.encodeWithSelector(IXBTGatewayAsset.transferFrom.selector, msg.sender, address(this), amount));
        require(_balance(asset) - beforeBalance == amount, "unexpected input amount");
    }

    function _safeTransfer(address asset, address to, uint256 amount) private {
        _callOptionalReturn(asset, abi.encodeWithSelector(IXBTGatewayAsset.transfer.selector, to, amount));
    }

    function _approveExact(address asset, address spender, uint256 amount) private {
        // Reset first for USDT implementations that require zero before nonzero.
        _callOptionalReturn(asset, abi.encodeWithSelector(IXBTGatewayAsset.approve.selector, spender, 0));
        if (amount > 0) _callOptionalReturn(asset, abi.encodeWithSelector(IXBTGatewayAsset.approve.selector, spender, amount));
    }

    function _refund(address asset, uint256 beforeBalance) private {
        uint256 surplus = _balance(asset) - beforeBalance;
        if (surplus > 0) _safeTransfer(asset, msg.sender, surplus);
    }

    function _callOptionalReturn(address asset, bytes memory data) private {
        (bool ok, bytes memory result) = asset.call(data);
        require(ok && (result.length == 0 || abi.decode(result, (bool))), "asset operation failed");
    }
}
