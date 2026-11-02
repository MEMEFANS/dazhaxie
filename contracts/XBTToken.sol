// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IXBTTradingGateway {
    function token() external view returns (address);
    function usdt() external view returns (address);
    function dexRouter() external view returns (address);
    function pair() external view returns (address);
    function receivingPairTokens() external view returns (bool);
    function addingLiquidity() external view returns (bool);
}

interface IXBTTradingPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function factory() external view returns (address);
}

interface IXBTDexRouter {
    function factory() external view returns (address);
}

interface IXBTDexFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

/**
 * CaBi 代币合约（BEP-20 / BSC），保留 XBTToken 源码标识以兼容部署工具。
 *
 * 5.1 代币基础
 * - 总量 10 亿枚，部署时全部一次性铸造给部署钱包，合约无任何增发入口。
 * - 持币人自行转账分配；代币合约不设置分配比例、预留池或分配锁仓。
 * - 普通地址默认最多持有 20 万枚；owner 可调整上限、设置资金地址豁免。
 *
 * 配置的 CaBi/USDT 交易对：
 * - 买入经 XBTTradingGateway，支付额的 3% USDT 直接进入分红接收地址，97% 兑换 CaBi。
 * - 卖入交易对：卖出数量的 3% CaBi 直接进入黑洞地址，97% 进入交易对。
 * - 普通钱包转账不收交易税；网关添加/移除流动性不收交易税。
 * - 精确 USDT 买税需要专用买入入口，不支持标准 DEX 页面直接买入该交易对。
 * - 不对未配置的其他交易对自动征税。
 * burn() 将持币人的代币转入黑洞地址，发行总量保持不变。
 */
contract XBTToken {
    string public constant name = "CaBi";
    string public constant symbol = "CaBi";
    uint8 public constant decimals = 18;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18; // 10 亿，永不增发
    uint256 public constant DEFAULT_MAX_WALLET_AMOUNT = 200_000 * 1e18;
    uint256 public constant SELL_FEE_BPS = 300;
    uint256 public constant FEE_DENOMINATOR = 10_000;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public owner;
    address public tradingGateway;
    address public tradingPair;
    address public usdt;
    uint256 public maxWalletAmount = DEFAULT_MAX_WALLET_AMOUNT;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public isMaxWalletExempt;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Burn(address indexed from, uint256 value);
    event TradingConfigured(address indexed gateway, address indexed pair, address indexed usdt);
    event SellFeeCharged(address indexed seller, uint256 grossAmount, uint256 burnedAmount);
    event MaxWalletAmountUpdated(uint256 previousAmount, uint256 newAmount);
    event MaxWalletExemptionSet(address indexed account, bool exempt);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        _setMaxWalletExempt(msg.sender, true);
        _setMaxWalletExempt(address(this), true);
        _setMaxWalletExempt(BURN_ADDRESS, true);
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    /// BEP-20 标准要求
    function getOwner() external view returns (address) {
        return owner;
    }

    function totalSupply() external pure returns (uint256) {
        return TOTAL_SUPPLY;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "allowance exceeded");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    /// 持币人销毁自己的代币（兑换大闸蟹等 100% 销毁场景）
    function burn(uint256 value) external {
        _transfer(msg.sender, BURN_ADDRESS, value);
        emit Burn(msg.sender, value);
    }

    /// amount 使用 18 位最小单位，例如 30 万枚为 300_000 * 1e18。
    function setMaxWalletAmount(uint256 amount) external onlyOwner {
        require(amount > 0 && amount <= TOTAL_SUPPLY, "invalid wallet limit");
        uint256 previousAmount = maxWalletAmount;
        maxWalletAmount = amount;
        emit MaxWalletAmountUpdated(previousAmount, amount);
    }

    /// 资金地址可先设置持仓豁免，再使用普通 transfer 自行分配。
    /// 持仓豁免不会免除卖出交易税。
    function setMaxWalletExempt(address account, bool exempt) external onlyOwner {
        require(account != address(0), "zero address");
        if (!exempt) {
            require(
                account != address(this) && account != BURN_ADDRESS
                    && account != tradingPair && account != tradingGateway,
                "system wallet exemption required"
            );
        }
        _setMaxWalletExempt(account, exempt);
    }

    /**
     * 一次配置官方交易入口与 CaBi/USDT 交易对。应在添加初始流动性前完成。
     * 网关的 USDT、DEX、分红地址均在部署时固定，后续不能任意替换。
     */
    function configureTrading(address gatewayAddress) external onlyOwner {
        require(tradingGateway == address(0), "trading already configured");
        require(gatewayAddress.code.length > 0, "invalid gateway");
        IXBTTradingGateway gateway = IXBTTradingGateway(gatewayAddress);
        require(gateway.token() == address(this), "wrong gateway token");
        address quote = gateway.usdt();
        address pairAddress = gateway.pair();
        require(quote != address(this) && quote.code.length > 0, "invalid usdt");
        require(pairAddress.code.length > 0, "invalid pair");
        IXBTTradingPair pair = IXBTTradingPair(pairAddress);
        require(
            (pair.token0() == address(this) && pair.token1() == quote)
                || (pair.token1() == address(this) && pair.token0() == quote),
            "wrong pair tokens"
        );
        address factory = IXBTDexRouter(gateway.dexRouter()).factory();
        require(pair.factory() == factory, "wrong pair factory");
        require(IXBTDexFactory(factory).getPair(address(this), quote) == pairAddress, "wrong factory pair");
        tradingGateway = gatewayAddress;
        tradingPair = pairAddress;
        usdt = quote;
        _setMaxWalletExempt(gatewayAddress, true);
        _setMaxWalletExempt(pairAddress, true);
        emit TradingConfigured(gatewayAddress, pairAddress, quote);
    }

    function _setMaxWalletExempt(address account, bool exempt) internal {
        isMaxWalletExempt[account] = exempt;
        emit MaxWalletExemptionSet(account, exempt);
    }

    function _checkMaxWallet(address from, address to, uint256 amount) internal view {
        if (from != to && amount > 0 && !isMaxWalletExempt[to]) {
            require(balanceOf[to] + amount <= maxWalletAmount, "max wallet exceeded");
        }
    }

    function _mint(address to, uint256 value) internal {
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "zero address");
        require(balanceOf[from] >= value, "balance not enough");

        if (tradingPair != address(0) && from == tradingPair) {
            require(
                to == tradingGateway && IXBTTradingGateway(tradingGateway).receivingPairTokens(),
                "use trading gateway for buys and liquidity removal"
            );
        }

        if (tradingPair != address(0) && to == tradingPair) {
            bool liquidityDeposit = from == tradingGateway && IXBTTradingGateway(tradingGateway).addingLiquidity();
            if (!liquidityDeposit) {
                uint256 fee = (value * SELL_FEE_BPS) / FEE_DENOMINATOR;
                uint256 netAmount = value - fee;
                _checkMaxWallet(from, to, netAmount);
                balanceOf[from] -= value;
                balanceOf[to] += netAmount;
                if (fee > 0) {
                    balanceOf[BURN_ADDRESS] += fee;
                    emit Transfer(from, BURN_ADDRESS, fee);
                    emit Burn(from, fee);
                }
                emit Transfer(from, to, netAmount);
                emit SellFeeCharged(from, value, fee);
                return;
            }
        }

        _checkMaxWallet(from, to, value);
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
