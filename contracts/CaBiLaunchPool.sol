// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILaunchAsset {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
}
interface ILaunchToken is ILaunchAsset {
    function owner() external view returns (address);
    function usdt() external view returns (address);
    function tradingPair() external view returns (address);
    function launchPool() external view returns (address);
    function liquidityEnabled() external view returns (bool);
    function isClaimOpen() external view returns (bool);
    function isTradingOpen() external view returns (bool);
    function beginLiquidityOperation(uint8) external;
    function endLiquidityOperation() external;
}
interface ILaunchPair {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112, uint112, uint32);
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function mint(address) external returns (uint256);
    function burn(address) external returns (uint256, uint256);
}
interface ILaunchPreviousPool {
    function signer() external view returns (address);
    function claimedOf(address) external view returns (uint256);
    function poolBalance() external view returns (uint256);
}

/**
 * Real V2 liquidity preparation, separate from timed token claims.
 * - Fixed price before trading: 700 CaBi per USDT; 70/30 entitlement split.
 * - Signature authorizes cumulative entitlement, never a wallet withdrawal.
 * - User LP is escrowed here until claims open, then belongs to lpReceiver.
 * - Before claims open, cancellation burns that user's escrowed LP and refunds
 *   actual USDT output; the 30% CaBi returns to the claim reserve.
 * - Prepared 70% payouts cannot be withdrawn by the owner.
 * New token/pool deployments only. Legacy live signatures must be retired and
 * the old pool emptied before participation in a migration is enabled.
 */
contract CaBiLaunchPool {
    address public immutable token;
    address public immutable usdt;
    address public immutable tradingPair;
    address public immutable lpReceiver;
    address public immutable previousPool;
    uint8 public immutable usdtDecimals;
    uint256 private immutable quoteUnit;
    bool private immutable tokenFirst;
    uint256 public constant TOKEN_PRICE_DENOMINATOR = 700 * 1e18;
    uint256 public constant PAYOUT_RATIO = 70;
    address public signer;
    address public seedProvider;
    uint256 private locked = 1;
    uint256 public reservedPayout;
    uint256 public escrowedLp;
    uint256 public totalPrepared;
    uint256 public totalClaimed;
    uint256 public totalLpTokens;
    uint256 public totalUsdtCharged;
    mapping(address => uint256) public preparedOf;
    mapping(address => uint256) public payoutAvailable;
    mapping(address => uint256) public claimedHere;
    mapping(address => uint256) public lpOf;
    mapping(address => uint256) public usdtPaidOf;
    mapping(address => uint256) public entitlementLimitOf;
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    bytes32 public constant PREPARE_TYPEHASH = keccak256("Prepare(address user,uint256 amount,uint256 cumulativeLimit,uint256 nonce,uint256 deadline)");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    struct Authorization { uint256 amount; uint256 cumulativeLimit; uint256 nonce; uint256 deadline; }
    event LiquidityPrepared(address indexed user, uint256 amount, uint256 payout, uint256 lpTokens, uint256 usdtPaid, uint256 liquidity, uint256 nonce);
    event PreparationCancelled(address indexed user, uint256 amount, uint256 tokensReturned, uint256 usdtRefunded, uint256 liquidityBurned);
    event Claimed(address indexed user, uint256 amount, uint256 payout);
    event SeedProviderUpdated(address indexed previousProvider, address indexed newProvider);
    event SeedLiquidityAdded(address indexed provider, uint256 tokens, uint256 usdtPaid, uint256 liquidity);
    event SeedLiquidityRemoved(address indexed provider, uint256 tokens, uint256 usdtReturned, uint256 liquidity);
    event ProjectLpReleased(address indexed receiver, uint256 liquidity);
    event SignerChanged(address indexed previousSigner, address indexed newSigner);
    event WithdrawUnused(address indexed owner, uint256 amount);

    modifier onlyOwner() { require(msg.sender == ILaunchToken(token).owner(), "not token owner"); _; }
    modifier onlySeedProvider() { require(msg.sender == seedProvider, "not seed provider"); _; }
    modifier nonReentrant() { require(locked == 1, "operation active"); locked = 2; _; locked = 1; }

    constructor(address token_, address signer_, address receiver_, address previous_) {
        require(token_.code.length > 0 && signer_ != address(0), "invalid token or signer");
        ILaunchToken asset = ILaunchToken(token_);
        address quote = asset.usdt(); address pair = asset.tradingPair();
        require(quote.code.length > 0 && pair.code.length > 0 && asset.decimals() == 18, "configure token trading first");
        require(receiver_ != address(0) && receiver_ != address(this) && receiver_ != pair && receiver_ != token_ && receiver_ != quote, "invalid LP receiver");
        require(previous_ == address(0) || previous_.code.length > 0, "invalid previous pool");
        uint8 precision = ILaunchAsset(quote).decimals(); require(precision <= 18, "unsupported USDT precision");
        token = token_; usdt = quote; tradingPair = pair; lpReceiver = receiver_; signer = signer_; previousPool = previous_;
        usdtDecimals = precision; quoteUnit = 10 ** precision; tokenFirst = ILaunchPair(pair).token0() == token_;
        emit SignerChanged(address(0), signer_);
    }
    function _checkParticipation() private view {
        ILaunchToken asset = ILaunchToken(token);
        require(asset.launchPool() == address(this) && asset.liquidityEnabled() && !asset.isTradingOpen(), "LP preparation not open");
        _checkPreviousRetired();
    }
    function _checkPreviousRetired() private view {
        if (previousPool == address(0)) return;
        require(ILaunchPreviousPool(previousPool).signer() == address(this) && ILaunchPreviousPool(previousPool).poolBalance() == 0, "retire previous pool first");
    }
    function poolBalance() public view returns (uint256) { return ILaunchAsset(token).balanceOf(address(this)); }
    function unusedBalance() public view returns (uint256) { uint256 b = poolBalance(); return b > reservedPayout ? b - reservedPayout : 0; }
    function claimedOf(address user) public view returns (uint256) { return _previousClaimed(user) + claimedHere[user]; }
    function _previousClaimed(address user) private view returns (uint256) { return previousPool == address(0) ? 0 : ILaunchPreviousPool(previousPool).claimedOf(user); }
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("CaBiLaunchPool"), keccak256("1"), block.chainid, address(this)));
    }
    function prepareDigest(address user, Authorization calldata authorization) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), keccak256(abi.encode(PREPARE_TYPEHASH, user, authorization.amount, authorization.cumulativeLimit, authorization.nonce, authorization.deadline))));
    }
    function previewPrepare(uint256 amount) public view returns (uint256 payout, uint256 lpTokens, uint256 usdtRequired, uint256 estimatedLiquidity) {
        payout = amount * PAYOUT_RATIO / 100; lpTokens = amount - payout;
        usdtRequired = _ceil(lpTokens * quoteUnit, TOKEN_PRICE_DENOMINATOR);
        (uint256 rt,) = _checkedReserves(); uint256 supply = ILaunchPair(tradingPair).totalSupply();
        if (supply > 0) estimatedLiquidity = lpTokens * supply / rt;
        require(amount > 0 && payout > 0 && usdtRequired > 0, "preparation too small");
    }
    function previewSeed(uint256 tokenAmount) public view returns (uint256 usdtRequired, uint256 estimatedLiquidity) {
        require(tokenAmount > 0, "zero token amount");
        usdtRequired = _ceil(tokenAmount * quoteUnit, TOKEN_PRICE_DENOMINATOR);
        (uint256 rt,) = _checkedReserves(); uint256 supply = ILaunchPair(tradingPair).totalSupply();
        if (supply == 0) { uint256 root = _sqrt(tokenAmount * usdtRequired); estimatedLiquidity = root > 1000 ? root - 1000 : 0; }
        else estimatedLiquidity = tokenAmount * supply / rt;
    }
    /// The owner designates the funder during Setup; opening liquidity freezes it.
    function setSeedProvider(address provider) external onlyOwner nonReentrant {
        require(!ILaunchToken(token).liquidityEnabled() && ILaunchPair(tradingPair).totalSupply() == 0, "seed provider locked");
        require(provider != address(0) && provider != address(this) && provider != token && provider != usdt && provider != tradingPair, "invalid seed provider");
        emit SeedProviderUpdated(seedProvider, provider); seedProvider = provider;
    }
    /// The designated provider supplies both assets and receives the LP. Users must
    /// wait for this seed to exist, so they do not bear the initial 1000 LP burn.
    function seedLiquidity(uint256 tokenAmount, uint256 usdtAmount, uint256 minLiquidity, uint256 deadline) external onlySeedProvider nonReentrant {
        _checkParticipation(); require(deadline >= block.timestamp, "deadline expired");
        require(tokenAmount > 0 && usdtAmount == _ceil(tokenAmount * quoteUnit, TOKEN_PRICE_DENOMINATOR), "wrong initial ratio");
        uint256 beforeBalance = poolBalance();
        _safeTransferFrom(token, msg.sender, address(this), tokenAmount);
        require(poolBalance() == beforeBalance + tokenAmount, "incorrect seed funding");
        uint256 liquidity = _addLiquidity(msg.sender, msg.sender, tokenAmount, usdtAmount, minLiquidity);
        require(poolBalance() == beforeBalance, "incorrect seed debit");
        emit SeedLiquidityAdded(msg.sender, tokenAmount, usdtAmount, liquidity);
    }
    function prepareLiquidity(Authorization calldata authorization, bytes calldata signature, uint256 maxUsdt, uint256 minLiquidity) external nonReentrant {
        _checkParticipation();
        require(authorization.amount > 0 && authorization.deadline >= block.timestamp, "invalid authorization");
        require(!nonceUsed[msg.sender][authorization.nonce], "nonce used");
        require(_recover(prepareDigest(msg.sender, authorization), signature) == signer, "invalid signature");
        require(_previousClaimed(msg.sender) + preparedOf[msg.sender] + authorization.amount <= authorization.cumulativeLimit, "exceeds entitlement");
        if (authorization.cumulativeLimit > entitlementLimitOf[msg.sender]) entitlementLimitOf[msg.sender] = authorization.cumulativeLimit;
        nonceUsed[msg.sender][authorization.nonce] = true;
        _prepare(authorization.amount, authorization.nonce, maxUsdt, minLiquidity);
    }
    function _prepare(uint256 amount, uint256 nonce, uint256 maxUsdt, uint256 minLiquidity) private {
        (uint256 payout, uint256 lpTokens, uint256 paid, uint256 estimate) = previewPrepare(amount);
        require(estimate > 0, "seed liquidity first"); require(paid <= maxUsdt, "USDT exceeds maximum");
        require(poolBalance() >= reservedPayout + amount, "insufficient payout reserve");
        preparedOf[msg.sender] += amount; payoutAvailable[msg.sender] += payout;
        reservedPayout += payout; totalPrepared += amount;
        uint256 liquidity = _addLiquidity(msg.sender, address(this), lpTokens, paid, minLiquidity);
        lpOf[msg.sender] += liquidity; escrowedLp += liquidity; usdtPaidOf[msg.sender] += paid;
        totalLpTokens += lpTokens; totalUsdtCharged += paid;
        emit LiquidityPrepared(msg.sender, amount, payout, lpTokens, paid, liquidity, nonce);
    }
    function claim() external nonReentrant {
        _claim(preparedOf[msg.sender] - claimedHere[msg.sender]);
    }
    /// Entitlement units, before the 70/30 split. The final claim receives
    /// rounding remainders; the unlimited token also permits claiming all at once.
    function claimPartial(uint256 amount) external nonReentrant { _claim(amount); }
    function _claim(uint256 amount) private {
        require(ILaunchToken(token).isClaimOpen(), "claims not open");
        _checkPreviousRetired();
        require(_previousClaimed(msg.sender) + preparedOf[msg.sender] <= entitlementLimitOf[msg.sender], "legacy entitlement changed");
        uint256 remaining = preparedOf[msg.sender] - claimedHere[msg.sender];
        require(amount > 0 && amount <= remaining, "invalid claim amount");
        uint256 payout = amount == remaining ? payoutAvailable[msg.sender] : amount * PAYOUT_RATIO / 100;
        require(payout > 0 && payout <= payoutAvailable[msg.sender], "nothing prepared to claim");
        payoutAvailable[msg.sender] -= payout; claimedHere[msg.sender] += amount;
        reservedPayout -= payout; totalClaimed += amount;
        _transferExact(token, msg.sender, payout);
        emit Claimed(msg.sender, amount, payout);
    }
    /// All currently prepared liquidity is cancelled together before claims
    /// open. USDT refund equals actual pair.burn output, protected by minUsdtOut.
    function cancelPreparation(uint256 minUsdtOut, uint256 deadline) external nonReentrant {
        require(!ILaunchToken(token).isClaimOpen() && deadline >= block.timestamp, "cancellation closed");
        uint256 liquidity = lpOf[msg.sender]; uint256 amount = preparedOf[msg.sender];
        require(liquidity > 0 && amount > 0, "nothing to cancel");
        reservedPayout -= payoutAvailable[msg.sender]; escrowedLp -= liquidity; totalPrepared -= amount;
        preparedOf[msg.sender] = 0; payoutAvailable[msg.sender] = 0; lpOf[msg.sender] = 0; usdtPaidOf[msg.sender] = 0;
        (uint256 returnedTokens, uint256 refunded) = _removeLiquidity(liquidity, minUsdtOut);
        _transferExact(usdt, msg.sender, refunded);
        emit PreparationCancelled(msg.sender, amount, returnedTokens, refunded, liquidity);
    }
    function releaseProjectLp() external nonReentrant {
        require(ILaunchToken(token).isClaimOpen(), "LP still cancellable");
        uint256 amount = escrowedLp; require(amount > 0, "no escrowed LP"); escrowedLp = 0;
        _transferExact(tradingPair, lpReceiver, amount);
        emit ProjectLpReleased(lpReceiver, amount);
    }
    /// Seed LP can exit through the wrapper before claims only when no user
    /// preparations remain. After trading opens, normal DEX removal is available.
    function removeSeedLiquidity(uint256 liquidity, uint256 minUsdtOut, uint256 minTokensOut, uint256 deadline) external onlySeedProvider nonReentrant {
        _checkParticipation(); require(!ILaunchToken(token).isClaimOpen() && totalPrepared == 0 && deadline >= block.timestamp, "seed removal closed");
        _safeTransferFrom(tradingPair, msg.sender, address(this), liquidity);
        (uint256 tokensReturned, uint256 usdtReturned) = _removeLiquidity(liquidity, minUsdtOut);
        require(tokensReturned >= minTokensOut, "insufficient tokens returned");
        _transferExact(token, msg.sender, tokensReturned); _transferExact(usdt, msg.sender, usdtReturned);
        emit SeedLiquidityRemoved(msg.sender, tokensReturned, usdtReturned, liquidity);
    }
    function withdrawUnused(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0 && amount <= unusedBalance(), "payout reserve protected");
        _transferExact(token, msg.sender, amount); emit WithdrawUnused(msg.sender, amount);
    }
    function setSigner(address next) external onlyOwner nonReentrant {
        require(next != address(0), "zero signer"); emit SignerChanged(signer, next); signer = next;
    }
    function _addLiquidity(address payer, address receiver, uint256 tokens, uint256 quote, uint256 minLiquidity) private returns (uint256 liquidity) {
        require(minLiquidity > 0, "set minimum LP output");
        (uint256 rt, uint256 rq) = _checkedReserves();
        uint256 beforeLp = ILaunchPair(tradingPair).balanceOf(receiver);
        ILaunchToken(token).beginLiquidityOperation(1);
        _safeTransfer(token, tradingPair, tokens); _safeTransferFrom(usdt, payer, tradingPair, quote);
        require(ILaunchAsset(token).balanceOf(tradingPair) == rt + tokens && ILaunchAsset(usdt).balanceOf(tradingPair) == rq + quote, "incorrect LP funding");
        liquidity = ILaunchPair(tradingPair).mint(receiver);
        ILaunchToken(token).endLiquidityOperation();
        require(liquidity >= minLiquidity && ILaunchPair(tradingPair).balanceOf(receiver) >= beforeLp + liquidity, "insufficient LP output");
        _checkedReserves();
    }
    function _removeLiquidity(uint256 liquidity, uint256 minUsdtOut) private returns (uint256 tokens, uint256 quote) {
        require(liquidity > 0, "zero LP amount"); _checkedReserves();
        // pair.burn burns the pair's entire LP balance; do not absorb pending LP.
        require(ILaunchPair(tradingPair).balanceOf(tradingPair) == 0, "pair has pending LP");
        uint256 beforeToken = poolBalance(); uint256 beforeQuote = ILaunchAsset(usdt).balanceOf(address(this));
        ILaunchToken(token).beginLiquidityOperation(2);
        _safeTransfer(tradingPair, tradingPair, liquidity);
        (uint256 a0, uint256 a1) = ILaunchPair(tradingPair).burn(address(this));
        ILaunchToken(token).endLiquidityOperation();
        (tokens, quote) = tokenFirst ? (a0, a1) : (a1, a0);
        require(quote >= minUsdtOut && poolBalance() == beforeToken + tokens && ILaunchAsset(usdt).balanceOf(address(this)) == beforeQuote + quote, "incorrect LP refund");
        _checkedReserves();
    }
    function _checkedReserves() private view returns (uint256 rt, uint256 rq) {
        (uint112 r0, uint112 r1,) = ILaunchPair(tradingPair).getReserves();
        (rt, rq) = tokenFirst ? (r0, r1) : (r1, r0);
        require(ILaunchAsset(token).balanceOf(tradingPair) == rt && ILaunchAsset(usdt).balanceOf(tradingPair) == rq, "pair balances need review");
        if (ILaunchPair(tradingPair).totalSupply() == 0) { require(rt == 0 && rq == 0, "nonempty initial pair"); return (rt, rq); }
        require(rt > 0 && rq > 0, "empty reserves");
        uint256 a = rt * quoteUnit; uint256 b = rq * TOKEN_PRICE_DENOMINATOR;
        uint256 delta = a > b ? a - b : b - a;
        // Allow only integer rounding: at least one smallest USDT unit, or
        // 1e-8 of the reference reserve value for accumulated decimal rounding.
        uint256 tolerance = a / 100_000_000;
        if (tolerance < TOKEN_PRICE_DENOMINATOR) tolerance = TOKEN_PRICE_DENOMINATOR;
        require(delta <= tolerance, "fixed LP ratio changed");
    }
    function _safeTransfer(address asset, address to, uint256 amount) private {
        (bool ok, bytes memory data) = asset.call(abi.encodeCall(ILaunchAsset.transfer, (to, amount)));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "asset transfer failed");
    }
    function _safeTransferFrom(address asset, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = asset.call(abi.encodeCall(ILaunchAsset.transferFrom, (from, to, amount)));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "asset approval or funding missing");
    }
    function _transferExact(address asset, address to, uint256 amount) private {
        uint256 beforeBalance = ILaunchAsset(asset).balanceOf(to); _safeTransfer(asset, to, amount);
        require(ILaunchAsset(asset).balanceOf(to) == beforeBalance + amount, "incorrect asset receipt");
    }
    function _ceil(uint256 n, uint256 d) private pure returns (uint256) { return n / d + (n % d == 0 ? 0 : 1); }
    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y == 0) return 0; z = y; uint256 x = y / 2 + 1;
        while (x < z) { z = x; x = (y / x + x) / 2; }
    }
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0); bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset, 32)) v := byte(0, calldataload(add(signature.offset, 64))) }
        if (v < 27) v += 27;
        if ((v != 27 && v != 28) || uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
