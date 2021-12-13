// SPDX-License-Identifier: MIT

pragma solidity 0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Staking Registry Contract
/// @notice You can use this contract for staking LP tokens
/// @dev All function calls are currently implemented without side effects
contract StakingRegistry is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Staking Contract => level.
    mapping(address => uint256) public levels;

    function setStakingContract(address _staking, uint256 _level) public onlyOwner {
        levels[_staking] = _level;
    }

    function renounceOwnership() public override onlyOwner {
        revert();
    }
}
