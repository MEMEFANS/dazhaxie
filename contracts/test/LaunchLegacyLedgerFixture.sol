// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Isolated, synthetic historical ledger for local migration workflow checks.
/// No real records, assets or production deployment.
contract LaunchLegacyLedgerFixture {
    address public signer;
    uint256 public constant poolBalance = 0;
    mapping(address => uint256) public claimedOf;
    constructor(address user, uint256 historicalAmount) { claimedOf[user] = historicalAmount; }
    function retireTo(address replacement) external { signer = replacement; }
}
