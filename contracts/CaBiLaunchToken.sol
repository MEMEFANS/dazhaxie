// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./CaBiPancakeToken.sol";

interface ICaBiLaunchPoolIdentity {
    function token() external view returns (address);
    function usdt() external view returns (address);
    function tradingPair() external view returns (address);
}

/**
 * CaBi with a one-way, publicly readable launch schedule.
 * Setup -> Liquidity -> Claims -> Trading. Only the dedicated launch pool can
 * add/remove liquidity before trading. No buy whitelist or owner trading bypass.
 * Normal transfers by holders start with trading; prepared claims can be paid
 * earlier. The schedule and launch pool cannot change after liquidity opens.
 */
contract CaBiLaunchToken is CaBiPancakeToken {
    enum Phase { Setup, Liquidity, Claims, Trading }
    address public launchPool;
    uint64 public claimStartsAt;
    uint64 public tradingStartsAt;
    bool public liquidityEnabled;
    // 0: none; 1: add; 2: remove. Set only for a synchronous pool operation.
    uint8 public liquidityOperation;

    event LaunchPoolConfigured(address indexed pool);
    event LaunchScheduled(uint64 claimStartsAt, uint64 tradingStartsAt);
    event LiquidityOpened(uint64 claimStartsAt, uint64 tradingStartsAt);

    constructor(address distributionReceiver_, address buybackPool_, address ownerAddress)
        CaBiPancakeToken(distributionReceiver_, buybackPool_, ownerAddress) {}

    function configureLaunchPool(address pool) external onlyOwner nonReentrant {
        require(launchPool == address(0) && tradingPair != address(0), "configure trading first");
        require(pool.code.length > 0 && pool != address(this) && pool != tradingPair && pool != dexRouter, "invalid launch pool");
        ICaBiLaunchPoolIdentity candidate = ICaBiLaunchPoolIdentity(pool);
        require(candidate.token() == address(this) && candidate.usdt() == usdt && candidate.tradingPair() == tradingPair, "launch pool mismatch");
        launchPool = pool; _setExempt(pool, true);
        emit LaunchPoolConfigured(pool);
    }
    /// Times can be edited during Setup only. Opening liquidity freezes them.
    function scheduleLaunch(uint64 claimAt, uint64 tradingAt) external onlyOwner nonReentrant {
        require(!liquidityEnabled && claimAt > block.timestamp && tradingAt >= claimAt, "invalid schedule");
        claimStartsAt = claimAt; tradingStartsAt = tradingAt;
        emit LaunchScheduled(claimAt, tradingAt);
    }
    function openLiquidity() external onlyOwner nonReentrant {
        require(!liquidityEnabled && launchPool != address(0) && claimStartsAt > block.timestamp, "launch not ready");
        liquidityEnabled = true;
        emit LiquidityOpened(claimStartsAt, tradingStartsAt);
    }
    function phase() public view returns (Phase) {
        if (!liquidityEnabled) return Phase.Setup;
        if (block.timestamp >= tradingStartsAt) return Phase.Trading;
        if (block.timestamp >= claimStartsAt) return Phase.Claims;
        return Phase.Liquidity;
    }
    function isClaimOpen() public view returns (bool) { return liquidityEnabled && block.timestamp >= claimStartsAt; }
    function isTradingOpen() public view returns (bool) { return liquidityEnabled && block.timestamp >= tradingStartsAt; }

    /// The immutable pool exposes only actual pair.mint / pair.burn operations.
    /// A revert rolls back both the operation and this temporary permission.
    function beginLiquidityOperation(uint8 operation) external {
        require(msg.sender == launchPool && liquidityEnabled && liquidityOperation == 0, "only idle launch pool");
        require(operation == 1 || operation == 2, "invalid LP operation");
        liquidityOperation = operation;
    }
    function endLiquidityOperation() external {
        require(msg.sender == launchPool && liquidityOperation != 0, "only active launch pool");
        liquidityOperation = 0;
    }
    function setMaxWalletExempt(address account, bool exempt) public override {
        require(exempt || account != launchPool, "launch pool exemption required");
        super.setMaxWalletExempt(account, exempt);
    }
    function nextPoolBurnTime() public view override returns (uint256) {
        if (!liquidityEnabled) return 0;
        uint256 start = lastPoolBurnTime > tradingStartsAt ? lastPoolBurnTime : tradingStartsAt;
        return start + POOL_BURN_INTERVAL;
    }
    function previewTaxSwap(uint256 amount) public view override returns (uint256 expectedUsdt, uint256 protectedMinimum) {
        require(isTradingOpen(), "trading not open");
        return super.previewTaxSwap(amount);
    }
    function _poolBurnEnabled() internal view override returns (bool) { return isTradingOpen() && liquidityOperation == 0; }
    function _liquidityTaxExempt(address from, address to) internal view override returns (bool) {
        return (liquidityOperation == 1 && from == launchPool && to == tradingPair && msg.sender == launchPool)
            || (liquidityOperation == 2 && from == tradingPair && to == launchPool && msg.sender == tradingPair);
    }
    function _beforeTransfer(address from, address to) internal view override {
        if (isTradingOpen() || _liquidityTaxExempt(from, to)) return;
        // Direct owner funding/allocations do not permit pair output or selling.
        if (from == owner && to != tradingPair && msg.sender == owner) return;
        if (from == owner && to == launchPool && msg.sender == launchPool) return;
        // Owner can recover uncommitted funds; users receive only prepared claims.
        if (from == launchPool && msg.sender == launchPool && to != tradingPair && (to == owner || isClaimOpen())) return;
        revert("transfers locked until trading");
    }
}
