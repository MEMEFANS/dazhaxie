// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface ICaBiClaimAsset {
    function balanceOf(address) external view returns (uint256);
    function transfer(address,uint256) external returns (bool);
    function transferFrom(address,address,uint256) external returns (bool);
}
interface ICaBiClaimSale {
    function xbt() external view returns (address);
    function usdt() external view returns (address);
    function claimPool() external view returns (address);
    function claimableOf(address) external view returns (uint256);
    function reservedTokens() external view returns (uint256);
    function consumeClaim(address,uint256) external;
}
interface ICaBiLiquidityToken {
    function tradingPair() external view returns (address);
    function dexRouter() external view returns (address);
    function usdt() external view returns (address);
    function SELL_FEE_BPS() external view returns (uint256);
    function FEE_DENOMINATOR() external view returns (uint256);
}
interface ICaBiLiquidityRouter { function factory() external view returns (address); }
interface ICaBiLiquidityFactory { function getPair(address,address) external view returns (address); }
interface ICaBiLiquidityPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function factory() external view returns (address);
    function getReserves() external view returns (uint112,uint112,uint32);
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function mint(address) external returns (uint256);
}
/// Timed subscription claims: 50% direct (remainder burned), or 70% direct
/// plus real V2 LP from the other 30% and user-supplied matching USDT.
/// LP belongs to the explicitly configured project receiver.
contract CaBiClaimPool {
    ICaBiClaimAsset public immutable token;
    ICaBiClaimSale public immutable sale;
    ICaBiClaimAsset public immutable usdt;
    address public owner;
    address public pendingOwner;
    address public lpReceiver;
    uint64 public claimStartsAt;
    uint256 public constant directRatio = 50;
    uint256 public constant lpRatio = 70;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 public totalClaimed;
    uint256 public totalBurned;
    uint256 public totalLpTokens;
    uint256 public totalLiquidityMinted;
    mapping(address => uint256) public claimed; // Actual CaBi paid to users.
    mapping(address => uint256) public settled; // Full entitlement consumed.
    uint256 private _status = 1;
    struct Quote { uint256 entitlement; uint256 payout; uint256 burnAmount; uint256 lpTokens; uint256 usdtRequired; uint256 estimatedLiquidity; address pair; }
    event Deposited(address indexed operator,uint256 amount,uint256 poolBalance);
    event WithdrawnUnused(address indexed operator,address indexed to,uint256 amount,uint256 poolBalance);
    event Claimed(address indexed user,uint8 mode,uint256 entitlement,uint256 payout,uint256 burned,uint256 lpTokens,uint256 usdtPaid,uint256 liquidity);
    event LiquidityCreated(address indexed user,address indexed pair,address indexed receiver,uint256 grossTokens,uint256 netTokens,uint256 usdtPaid,uint256 liquidity);
    event LpReceiverUpdated(address indexed previousReceiver,address indexed receiver);
    event ClaimStartsAtUpdated(uint64 previousStartsAt,uint64 startsAt);
    event OwnershipTransferStarted(address indexed owner,address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner,address indexed newOwner);
    modifier onlyOwner() { require(msg.sender == owner,"not owner"); _; }
    modifier nonReentrant() { require(_status == 1,"reentrant"); _status = 2; _; _status = 1; }
    constructor(address tokenAddress,address saleAddress,address ownerAddress) {
        require(tokenAddress.code.length > 0 && saleAddress.code.length > 0 && tokenAddress != saleAddress,"invalid contracts");
        require(ownerAddress != address(0) && ownerAddress != address(this),"invalid owner");
        ICaBiClaimSale source = ICaBiClaimSale(saleAddress);
        require(source.xbt() == tokenAddress && source.claimPool() == address(0),"sale mismatch");
        address quoteAsset = source.usdt();
        require(quoteAsset.code.length > 0 && quoteAsset != tokenAddress,"invalid quote");
        token = ICaBiClaimAsset(tokenAddress); sale = source; usdt = ICaBiClaimAsset(quoteAsset); owner = ownerAddress;
        emit OwnershipTransferred(address(0),ownerAddress);
    }
    function poolBalance() public view returns (uint256) { return token.balanceOf(address(this)); }
    function totalAllocated() public view returns (uint256) { return sale.reservedTokens(); }
    function claimable(address user) public view returns (uint256) { return sale.claimPool() == address(this) ? sale.claimableOf(user) : 0; }
    function unusedBalance() public view returns (uint256) { uint256 balance = poolBalance(); uint256 reserved = totalAllocated(); return balance > reserved ? balance - reserved : 0; }
    function tradingPair() public view returns (address) { try ICaBiLiquidityToken(address(token)).tradingPair() returns (address value) { return value; } catch { return address(0); } }
    function dexRouter() public view returns (address) { try ICaBiLiquidityToken(address(token)).dexRouter() returns (address value) { return value; } catch { return address(0); } }
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0,"zero amount"); uint256 beforeBalance = poolBalance();
        _safe(address(token),abi.encodeWithSelector(token.transferFrom.selector,msg.sender,address(this),amount));
        require(poolBalance() == beforeBalance + amount,"incorrect deposit amount"); emit Deposited(msg.sender,amount,poolBalance());
    }
    function withdrawUnused(uint256 amount,address to) external onlyOwner nonReentrant {
        require(to != address(0) && to != address(this),"invalid recipient");
        require(amount > 0 && amount <= unusedBalance(),"exceeds unused balance");
        _transferExact(to,amount); emit WithdrawnUnused(msg.sender,to,amount,poolBalance());
    }
    function setClaimStartsAt(uint64 startsAt) external onlyOwner nonReentrant {
        require(startsAt == 0 || startsAt > block.timestamp,"start must be future");
        emit ClaimStartsAtUpdated(claimStartsAt,startsAt); claimStartsAt = startsAt;
    }
    function setLpReceiver(address receiver) external onlyOwner nonReentrant {
        require(_validReceiver(receiver),"invalid LP receiver");
        emit LpReceiverUpdated(lpReceiver,receiver); lpReceiver = receiver;
    }
    function previewClaim(address user,uint8 mode) external view returns (uint256 entitlement,uint256 payout,uint256 burnAmount,uint256 lpTokens,uint256 usdtRequired,uint256 estimatedLiquidity,address pair) {
        Quote memory q = _quote(user,mode);
        return (q.entitlement,q.payout,q.burnAmount,q.lpTokens,q.usdtRequired,q.estimatedLiquidity,q.pair);
    }
    /// Direct mode needs no quote asset, approval, pair, or liquidity.
    function claim(uint8 mode) external nonReentrant { require(mode == 0,"use checked LP claim"); _claim(mode,0,0,0); }
    function claimChecked(uint8 mode,uint256 expectedAmount,uint64 expectedStartsAt,address expectedLpReceiver,uint256 maxUsdt,uint256 minLiquidity,uint256 deadline) external nonReentrant {
        require(claimStartsAt == expectedStartsAt && claimable(msg.sender) == expectedAmount && lpReceiver == expectedLpReceiver,"claim quote changed");
        _claim(mode,maxUsdt,minLiquidity,deadline);
    }
    function transferOwnership(address nextOwner) external onlyOwner nonReentrant { require(nextOwner != address(0) && nextOwner != address(this),"invalid owner"); pendingOwner = nextOwner; emit OwnershipTransferStarted(owner,nextOwner); }
    function acceptOwnership() external nonReentrant { require(msg.sender == pendingOwner,"not pending owner"); address previous = owner; owner = msg.sender; pendingOwner = address(0); emit OwnershipTransferred(previous,msg.sender); }
    function _quote(address user,uint8 mode) private view returns (Quote memory q) {
        require(mode <= 1,"invalid mode"); q.entitlement = claimable(user);
        q.payout = q.entitlement * (mode == 0 ? directRatio : lpRatio) / 100;
        if (mode == 0) { q.burnAmount = q.entitlement - q.payout; return q; }
        require(_validReceiver(lpReceiver),"LP receiver not configured");
        q.lpTokens = q.entitlement - q.payout; q.pair = _validatedPair();
        (uint256 rt,uint256 rq) = _cleanReserves(q.pair);
        uint256 net = q.lpTokens - q.lpTokens * 300 / 10000;
        q.usdtRequired = _ceil(net * rq,rt);
        q.estimatedLiquidity = net * ICaBiLiquidityPair(q.pair).totalSupply() / rt;
        require(q.entitlement == 0 || (net > 0 && q.usdtRequired > 0 && q.estimatedLiquidity > 0),"liquidity too small");
    }
    function _claim(uint8 mode,uint256 maxUsdt,uint256 minLiquidity,uint256 deadline) private {
        require(sale.claimPool() == address(this),"pool not bound");
        require(claimStartsAt != 0 && block.timestamp >= claimStartsAt,"claims not open");
        Quote memory q = _quote(msg.sender,mode);
        require(q.entitlement > 0 && q.payout > 0,"nothing claimable");
        require(poolBalance() >= totalAllocated(),"pool balance insufficient");
        if (mode == 1) require(maxUsdt > 0 && minLiquidity > 0 && deadline > block.timestamp && deadline <= block.timestamp + 30 minutes,"invalid LP protection");
        else require(maxUsdt == 0 && minLiquidity == 0 && deadline == 0,"unexpected direct protection");
        sale.consumeClaim(msg.sender,q.entitlement);
        settled[msg.sender] += q.entitlement; claimed[msg.sender] += q.payout; totalClaimed += q.payout;
        uint256 paid; uint256 liquidity;
        if (mode == 0) { _transferExact(BURN_ADDRESS,q.burnAmount); totalBurned += q.burnAmount; }
        else { (paid,liquidity) = _addLiquidity(q,maxUsdt,minLiquidity); totalLpTokens += q.lpTokens; totalLiquidityMinted += liquidity; }
        _transferExact(msg.sender,q.payout);
        require(poolBalance() >= totalAllocated(),"pool balance insufficient");
        emit Claimed(msg.sender,mode,q.entitlement,q.payout,q.burnAmount,q.lpTokens,paid,liquidity);
    }
    function _addLiquidity(Quote memory q,uint256 maxUsdt,uint256 minLiquidity) private returns (uint256 paid,uint256 liquidity) {
        uint256 beforePool = poolBalance();
        // Keep the token sell tax and any swapback; quote using resulting reserves.
        _safe(address(token),abi.encodeWithSelector(token.transfer.selector,q.pair,q.lpTokens));
        require(poolBalance() == beforePool - q.lpTokens,"incorrect LP debit");
        (uint256 rt,uint256 rq) = _reserves(q.pair);
        uint256 afterToken = token.balanceOf(q.pair);
        require(afterToken >= rt && usdt.balanceOf(q.pair) == rq,"dirty pair balance");
        uint256 net = afterToken - rt;
        require(net == q.lpTokens - q.lpTokens * 300 / 10000 && net > 0,"incorrect LP tokens");
        paid = _ceil(net * rq,rt); require(paid > 0 && paid <= maxUsdt,"USDT exceeds maximum");
        uint256 beforeUser = usdt.balanceOf(msg.sender);
        _safe(address(usdt),abi.encodeWithSelector(usdt.transferFrom.selector,msg.sender,q.pair,paid));
        require(usdt.balanceOf(q.pair) == rq + paid && usdt.balanceOf(msg.sender) == beforeUser - paid && token.balanceOf(q.pair) == afterToken,"incorrect USDT amount");
        uint256 beforeLP = ICaBiLiquidityPair(q.pair).balanceOf(lpReceiver);
        liquidity = ICaBiLiquidityPair(q.pair).mint(lpReceiver);
        require(liquidity >= minLiquidity && liquidity > 0 && ICaBiLiquidityPair(q.pair).balanceOf(lpReceiver) >= beforeLP + liquidity,"insufficient LP output");
        _cleanReserves(q.pair);
        emit LiquidityCreated(msg.sender,q.pair,lpReceiver,q.lpTokens,net,paid,liquidity);
    }
    function _validatedPair() private view returns (address pair) {
        pair = tradingPair(); address router = dexRouter();
        require(pair.code.length > 0 && router.code.length > 0,"LP not configured");
        ICaBiLiquidityToken asset = ICaBiLiquidityToken(address(token));
        require(asset.usdt() == address(usdt) && asset.SELL_FEE_BPS() == 300 && asset.FEE_DENOMINATOR() == 10000,"unsupported LP token");
        address factory = ICaBiLiquidityRouter(router).factory();
        require(factory.code.length > 0 && ICaBiLiquidityPair(pair).factory() == factory && ICaBiLiquidityFactory(factory).getPair(address(token),address(usdt)) == pair,"invalid LP pair");
        address t0 = ICaBiLiquidityPair(pair).token0(); address t1 = ICaBiLiquidityPair(pair).token1();
        require((t0 == address(token) && t1 == address(usdt)) || (t1 == address(token) && t0 == address(usdt)),"wrong LP assets");
    }
    function _reserves(address pair) private view returns (uint256 rt,uint256 rq) {
        (uint112 r0,uint112 r1,) = ICaBiLiquidityPair(pair).getReserves();
        (rt,rq) = ICaBiLiquidityPair(pair).token0() == address(token) ? (uint256(r0),uint256(r1)) : (uint256(r1),uint256(r0));
        require(rt > 0 && rq > 0 && ICaBiLiquidityPair(pair).totalSupply() > 0,"no LP liquidity");
    }
    function _cleanReserves(address pair) private view returns (uint256 rt,uint256 rq) {
        (rt,rq) = _reserves(pair);
        require(token.balanceOf(pair) == rt && usdt.balanceOf(pair) == rq,"dirty pair balance");
    }
    function _validReceiver(address receiver) private view returns (bool) {
        return receiver != address(0) && receiver != BURN_ADDRESS && receiver != address(this) && receiver != address(token) && receiver != address(sale) && receiver != address(usdt) && receiver != tradingPair() && receiver != dexRouter();
    }
    function _transferExact(address to,uint256 amount) private {
        if (amount == 0) return;
        uint256 beforePool = poolBalance(); uint256 beforeRecipient = token.balanceOf(to);
        _safe(address(token),abi.encodeWithSelector(token.transfer.selector,to,amount));
        require(poolBalance() == beforePool - amount && token.balanceOf(to) == beforeRecipient + amount,"incorrect payout amount");
    }
    function _safe(address asset,bytes memory data) private {
        (bool ok,bytes memory result) = asset.call(data);
        require(ok && (result.length == 0 || (result.length == 32 && abi.decode(result,(bool)))),"asset transfer failed");
    }
    function _ceil(uint256 numerator,uint256 denominator) private pure returns (uint256) { return numerator / denominator + (numerator % denominator == 0 ? 0 : 1); }
}
