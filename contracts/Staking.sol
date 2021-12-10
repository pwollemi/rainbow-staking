// SPDX-License-Identifier: MIT

pragma solidity 0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Staking Contract
/// @notice You can use this contract for staking LP tokens
/// @dev All function calls are currently implemented without side effects
contract Staking is Ownable {
    using SafeERC20 for IERC20;
    using SafeCast for int256;
    using SafeCast for uint256;

    /// @notice Info of each user.
    /// `share` user's share of the staking pool
    /// `amount` The orginal amount that staked by the user.
    /// `lastDepositedAt` The timestamp of the last deposit.
    struct UserInfo {
        uint256 share;
        uint256 amount;
        uint256 lastDepositedAt;
    }

    uint256 private constant ACC_REWARD_PRECISION = 1e12;

    /// @notice Address of Rainbow token contract.
    IERC20 public token;

    /// @notice Amount of reward token allocated per second.
    uint256 public rewardPerSecond;

    /// @notice Total shares amount
    uint256 public totalShares;

    /// @notice Last time that the reward is calculated.
    uint256 public lastRewardTime;

    /// @notice Reward treasury
    address public rewardTreasury;

    /// @notice Info of each user that stakes LP tokens.
    mapping(address => UserInfo) public userInfo;

    /// @notice Duration for unstake/claim penalty
    uint256 public earlyWithdrawal;

    /// @notice Penalty rate with 2 dp (e.g. 1000 = 10%)
    uint256 public penaltyRate;

    event Deposit(address indexed user, uint256 amount, uint256 share, address indexed to);
    event Withdraw(address indexed user, uint256 amount, uint256 share, address indexed to);
    event EmergencyWithdraw(address indexed user, uint256 amount, uint256 share, address indexed to);
    event Harvest(address indexed user, uint256 amount);

    event LogUpdatePool(uint256 lastRewardTime, uint256 lpSupply);
    event LogRewardPerSecond(uint256 rewardPerSecond);
    event LogPenaltyParams(uint256 earlyWithdrawal, uint256 penaltyRate);
    event LogRewardTreasury(address indexed wallet);

    /**
     * @param _token The LP token contract address.
     */
    constructor(
        IERC20 _token
    ) {
        require(address(_token) != address(0), "initialize: token address cannot be zero");

        token = _token;
        lastRewardTime = block.timestamp;

        earlyWithdrawal = 30 days;
        penaltyRate = 0;
    }

    /**
     * @notice Set the penalty information
     * @param _earlyWithdrawal The new earlyWithdrawal
     * @param _penaltyRate The new penaltyRate
     */
    function setPenaltyInfo(uint256 _earlyWithdrawal, uint256 _penaltyRate) external onlyOwner {
        earlyWithdrawal = _earlyWithdrawal;
        penaltyRate = _penaltyRate;
        emit LogPenaltyParams(_earlyWithdrawal, _penaltyRate);
    }

    /**
     * @notice Sets the  per second to be distributed. Can only be called by the owner.
     * @dev Its decimals count is ACC_REWARD_PRECISION
     * @param _rewardPerSecond The amount of reward to be distributed per second.
     */
    function setRewardPerSecond(uint256 _rewardPerSecond) public onlyOwner {
        updatePool();
        rewardPerSecond = _rewardPerSecond;
        emit LogRewardPerSecond(_rewardPerSecond);
    }

    /**
     * @notice set reward wallet
     * @param _wallet address that contains the rewards
     */
    function setRewardTreasury(address _wallet) external onlyOwner {
        rewardTreasury = _wallet;
        emit LogRewardTreasury(_wallet);
    }

    /**
     * @notice return available reward amount
     * @return rewardInTreasury reward amount in treasury
     * @return rewardAllowedForThisPool allowed reward amount to be spent by this pool
     */
    function availableReward()
        public
        view
        returns (uint256 rewardInTreasury, uint256 rewardAllowedForThisPool)
    {
        rewardInTreasury = token.balanceOf(rewardTreasury);
        rewardAllowedForThisPool = token.allowance(
            rewardTreasury,
            address(this)
        );
    }

    /**
     * @notice Returns the stake info of a specifc user.
     * @dev Calculates stakeAmount from the share
     * @param _user Address of the user
     * @return share of the user
     * @return stakeAmount of the user
     */
    function getStakeInfo(address _user) external view returns (uint256 share, uint256 stakeAmount) {
        UserInfo memory user = userInfo[_user];
        share = user.share;
        stakeAmount = roundShareToAmount(share, token.balanceOf(address(this)), totalShares);
    }

    /**
     * @notice View function to see pending reward on frontend.
     *
     *  pending reward = (user.share * total supply) / total shares - staked amount
     *
     * @param _user Address of user.
     * @return pending reward for a given user.
     */
    function pendingReward(address _user) external view returns (uint256 pending) {
        if (totalShares == 0) return 0;

        UserInfo memory user = userInfo[_user];
        uint256 tokenSupply_ = token.balanceOf(address(this));

        if (block.timestamp > lastRewardTime && totalShares != 0) {
            uint256 newReward = (block.timestamp - lastRewardTime) * rewardPerSecond;
            tokenSupply_ = tokenSupply_ + newReward;
        }
        pending = roundShareToAmount(user.share, tokenSupply_, totalShares) - user.amount;
    }

    /**
     * @notice Update reward variables.
     * @dev Updates accRewardPerShare and lastRewardTime.
     */
    function updatePool() public {
        if (block.timestamp > lastRewardTime) {
            if (totalShares > 0) {
                uint256 newReward = (block.timestamp - lastRewardTime) * rewardPerSecond;
                token.safeTransferFrom(rewardTreasury, address(this), newReward);
            }
            lastRewardTime = block.timestamp;
            emit LogUpdatePool(block.timestamp, token.balanceOf(address(this)));
        }
    }

    /**
     * @notice Deposit LP tokens for reward allocation.
     * @param amount LP token amount to deposit.
     * @param to The receiver of `amount` deposit benefit.
     */
    function deposit(uint256 amount, address to) public {
        updatePool();
        UserInfo storage user = userInfo[to];

        // Effects
        uint256 share;
        if (totalShares > 0) {
            share = roundAmountToShare(amount, token.balanceOf(address(this)), totalShares);
        } else {
            share = amount;
        }
        totalShares = totalShares + share;

        user.share = user.share + share;
        user.lastDepositedAt = block.timestamp;
        user.amount = user.amount + amount;

        emit Deposit(msg.sender, amount, share, to);

        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Withdraw LP tokens and harvest rewards to `to`.
     * @param amount LP token amount to withdraw.
     * @param to Receiver of the LP tokens and rewards.
     */
    function withdraw(uint256 amount, address to) public {
        if (totalShares == 0) return;

        updatePool();
        UserInfo storage user = userInfo[msg.sender];
        uint256 _pendingReward = roundShareToAmount(user.share, token.balanceOf(address(this)), totalShares) - user.amount;
        uint256 withdrawAmount = amount + _pendingReward;

        uint256 shareFromAmount = roundAmountToShare(withdrawAmount, token.balanceOf(address(this)), totalShares);
        if (shareFromAmount > user.share) {
            shareFromAmount = user.share;
            withdrawAmount = roundShareToAmount(shareFromAmount, token.balanceOf(address(this)), totalShares);
        }

        // Effects
        user.share = user.share - shareFromAmount;
        totalShares = totalShares - shareFromAmount;
        user.amount = user.amount - amount;

        emit Withdraw(msg.sender, amount, shareFromAmount, to);
        emit Harvest(msg.sender, _pendingReward);

        // Interactions
        if (isEarlyWithdrawal(user.lastDepositedAt)) {
            uint256 penaltyAmount = _pendingReward * penaltyRate / 10000;
            token.safeTransfer(to, withdrawAmount - penaltyAmount);
            token.safeTransfer(address(0xdead), _pendingReward);
        } else {
            token.safeTransfer(to, withdrawAmount);
        }
    }

    /**
     * @notice Harvest rewards and send to `to`.
     * @dev Here comes the formula to calculate reward token amount
     * @param to Receiver of rewards.
     */
    function harvest(address to) public {
        if (totalShares == 0) return;

        updatePool();
        UserInfo storage user = userInfo[msg.sender];
        uint256 _pendingReward = roundShareToAmount(user.share, token.balanceOf(address(this)), totalShares) - user.amount;
        uint256 shareFromAmount = roundAmountToShare(_pendingReward, token.balanceOf(address(this)), totalShares);

        // Effects
        user.share = user.share - shareFromAmount;
        totalShares = totalShares - shareFromAmount;

        emit Harvest(msg.sender, _pendingReward);

        // Interactions
        if (_pendingReward != 0) {
            if (isEarlyWithdrawal(user.lastDepositedAt)) {
                uint256 penaltyAmount = _pendingReward * penaltyRate / 10000;
                token.safeTransfer(to, _pendingReward - penaltyAmount);
                token.safeTransfer(address(0xdead), penaltyAmount);
            } else {
                token.safeTransfer(to, _pendingReward);
            }
        }
    }

    /**
     * @notice Withdraw without caring about rewards. EMERGENCY ONLY.
     * @param to Receiver of the LP tokens.
     */
    function emergencyWithdraw(address to) public {
        UserInfo storage user = userInfo[msg.sender];
        uint256 share = user.share;
        uint256 amount = user.amount;
        totalShares = totalShares - share;
        user.share = 0;
        user.amount = 0;

        emit EmergencyWithdraw(msg.sender, amount, share, to);

        // Note: transfer can fail or succeed if `amount` is zero.
        token.safeTransfer(to, amount);
    }

    /**
     * @notice check if user in penalty period
     * @return isEarly
     */
    function isEarlyWithdrawal(uint256 lastDepositedTime) internal view returns (bool isEarly) {
        isEarly = block.timestamp <= lastDepositedTime + earlyWithdrawal;
    }

    function renounceOwnership() public override onlyOwner {
        revert();
    }

    function roundAmountToShare(uint256 amount_, uint256 totalTokens_, uint256 totalShares_) internal view returns (uint256 share_) {
        if (totalTokens_ == 0) {
            return 0;
        }
        share_ = amount_ * totalShares_ / totalTokens_;
        if (share_ > totalShares_) {
            share_ = totalShares_;
        }
    }

    function roundShareToAmount(uint256 share_, uint256 totalTokens_, uint256 totalShares_) internal view returns (uint256 amount_) {
        if (totalShares_ == 0) {
            return 0;
        }
        amount_ = share_ * totalTokens_ / totalShares_;
        if (amount_ > totalTokens_) {
            amount_ = totalTokens_;
        }
    }
}
