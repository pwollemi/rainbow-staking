// SPDX-License-Identifier: MIT

pragma solidity 0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @title Staking Registry Contract
/// @notice You can use this contract for staking LP tokens
/// @dev All function calls are currently implemented without side effects
contract StakingRegistry is Initializable, OwnableUpgradeable {

    /// @notice Staking Contract => level.
    mapping(address => uint256) public levels;

    function initialize() external initializer {
        __Ownable_init();
    }

    function setStakingContract(address _staking, uint256 _level) public onlyOwner {
        levels[_staking] = _level;
    }

    function renounceOwnership() public override onlyOwner {
        revert();
    }
}
