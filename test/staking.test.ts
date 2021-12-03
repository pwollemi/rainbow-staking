/* eslint-disable no-await-in-loop */
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import chai from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber } from "ethers";
import { CustomToken, RainbowToken, Staking } from "../typechain";
import {
  getLatestBlockTimestamp,
  mineBlock,
  advanceTime,
  duration,
  getBigNumber,
  advanceTimeAndBlock,
} from "../helper/utils";
import { deployContract, deployProxy } from "../helper/deployer";

chai.use(solidity);
const { expect } = chai;

describe("Staking Pool", () => {
  let totalSupply: BigNumber;
  let totalRewardAmount: BigNumber;
  
  // to avoid complex calculation of decimals, we set an easy value
  const rewardPerSecond = BigNumber.from("1000000000000");
  
  let staking: Staking;
  let rainbow: RainbowToken;
  let rewardToken: CustomToken;
  
  let deployer: SignerWithAddress;
  let bob: SignerWithAddress;
  let alice: SignerWithAddress;
  let tom: SignerWithAddress;
  let rewardTreasury: SignerWithAddress;

  let rainbowSupply;

  before(async () => {
    [deployer, bob, alice, tom, rewardTreasury] = await ethers.getSigners();
  });

  beforeEach(async () => {
    rainbow = <RainbowToken>(
      await deployContract("RainbowToken")
    );
    // rewardToken = <CustomToken>(
    //   await deployContract("CustomToken", "Reward token", "REWARD", totalSupply)
    // );
    rewardToken = rainbow;
    staking = <Staking>(
      await deployProxy(
        "Staking",
        rewardToken.address,
        rainbow.address,
      )
    );
    totalSupply = await rainbow.totalSupply();
    totalRewardAmount = totalSupply.div(2);

    await staking.setRewardPerSecond(rewardPerSecond);
    await staking.setRewardTreasury(deployer.address);

    await rewardToken.transfer(rewardTreasury.address, totalRewardAmount);
    await rewardToken.approve(staking.address, ethers.constants.MaxUint256);

    rainbowSupply = await rainbow.totalSupply();
    await rainbow.transfer(bob.address, rainbowSupply.div(5));
    await rainbow.transfer(alice.address, rainbowSupply.div(5));
    await rainbow.approve(staking.address, ethers.constants.MaxUint256);
    await rainbow.connect(bob).approve(staking.address, ethers.constants.MaxUint256);
    await rainbow.connect(alice).approve(staking.address, ethers.constants.MaxUint256);
    await rainbow.excludeFromFee(staking.address);
    await rainbow.excludeFromFee(alice.address);
  });

  describe("initialize", async () => {
    it("Validiation of initilize params", async () => {
      await expect(
        deployProxy(
          "Staking",
          ethers.constants.AddressZero,
          rainbow.address,
        )
      ).to.be.revertedWith("initialize: reward token address cannot be zero");
      await expect(
        deployProxy(
          "Staking",
          rewardToken.address,
          ethers.constants.AddressZero,
        )
      ).to.be.revertedWith("initialize: LP token address cannot be zero");
    });
  });

  describe("Deposit/withdraw reward token", () => {
    const tokenAmount = getBigNumber(1);

    it("Only owner can do these operation", async () => {
      await expect(
        staking.connect(bob).depositReward(tokenAmount)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await staking.depositReward(tokenAmount);

      await expect(
        staking.connect(bob).withdrawReward(tokenAmount)
      ).to.be.revertedWith("Ownable: caller is not the owner");
        await staking.withdrawReward(tokenAmount);
    });
  });

  describe("Set penalty info", () => {
    const newPenaltyPeriod = duration.days(20);
    const newPenaltyRate = 1000;

    it("Only owner can do these operation", async () => {
      await expect(staking.connect(bob).setPenaltyInfo(newPenaltyPeriod, newPenaltyRate)).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("It correctly updates information", async () => {
      await staking.setPenaltyInfo(newPenaltyPeriod, newPenaltyRate);
      expect(await staking.earlyWithdrawal()).to.be.equal(newPenaltyPeriod);
      expect(await staking.penaltyRate()).to.be.equal(newPenaltyRate);
    });
  });

  describe("Set Reward per second", () => {
    const newRewardPerSecond = 100;

    it("Only owner can do these operation", async () => {
      await expect(
        staking.connect(bob).setRewardPerSecond(newRewardPerSecond)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("It correctly updates information", async () => {
      await staking.setRewardPerSecond(newRewardPerSecond);
      expect(await staking.rewardPerSecond()).to.be.equal(newRewardPerSecond);
    });
  });

  describe("Deposit", () => {
    it("Deposit 1 amount", async () => {
      await expect(staking.deposit(getBigNumber(1, 9), bob.address))
        .to.emit(staking, "Deposit")
        .withArgs(deployer.address, getBigNumber(1, 9), getBigNumber(1, 9), bob.address);
    });

    it("Staking amount increases", async () => {
      const stakeAmount1 = getBigNumber("10", 9);
      const stakeAmount2 = getBigNumber("4", 9);

      await staking.deposit(stakeAmount1, bob.address);
      console.log((await (rainbow.balanceOf(staking.address))).toString());
      await rainbow.connect(alice).transfer(bob.address, getBigNumber("1", 9));
      console.log((await (rainbow.balanceOf(staking.address))).toString());
      // console.log((await staking.totalShares()).toString());
      // console.log((await staking.userInfo(bob.address)).share.toString());
      // expect((await staking.getStakeInfo(bob.address)).stakeAmount).to.be.equal(stakeAmount1);

      await staking.deposit(stakeAmount2, bob.address);
      console.log((await (rainbow.balanceOf(staking.address))).toString());
      // console.log((await staking.totalShares()).toString());
      // console.log((await staking.userInfo(bob.address)).share.toString());
      // expect((await staking.getStakeInfo(bob.address)).stakeAmount).to.be.equal(stakeAmount1.add(stakeAmount2));
    });
  });

  describe("PendingReward", () => {
    it("Should be zero when lp supply is zero", async () => {
      await advanceTime(86400);
      await staking.updatePool();
      expect(await staking.pendingReward(alice.address)).to.be.equal(0);
    });

    it("PendingRward should equal ExpectedReward", async () => {
      await staking.deposit(getBigNumber(1, 9), alice.address);
      await advanceTime(86400);
      await mineBlock();
      const expectedReward = rewardPerSecond.mul(86400);
      expect(await staking.pendingReward(alice.address)).to.be.equal(
        expectedReward
      );
    });
  });

  describe("Update Pool", () => {
    it("LogUpdatePool event is emitted", async () => {
      await staking.deposit(getBigNumber(1, 9), alice.address);
      await expect(staking.updatePool())
        .to.emit(staking, "LogUpdatePool")
        .withArgs(
          await staking.lastRewardTime(),
          await rainbow.balanceOf(staking.address),
          await staking.accRewardPerShare()
        );
    });
  });

  describe("Harvest", () => {
    it("Should give back the correct amount of REWARD", async () => {
      const period = duration.days(31).toNumber();
      const expectedReward = rewardPerSecond.mul(period);

      await staking.deposit(getBigNumber(1, 9), alice.address);
      await advanceTime(period);
      const balance0 = await rewardToken.balanceOf(alice.address);
      await staking.connect(alice).harvest(alice.address);
      const balance1 = await rewardToken.balanceOf(alice.address);

      expect(balance1.sub(balance0)).to.be.equal(
        expectedReward
      );
      expect((await staking.userInfo(alice.address)).rewardDebt).to.be.equal(
        expectedReward
      );
      expect(await staking.pendingReward(alice.address)).to.be.equal(0);
    });

    it("Penalty Applied", async () => {
      await staking.setPenaltyInfo(duration.days(20), 1000);

      const period = duration.days(10).toNumber();
      const expectedReward = rewardPerSecond.mul(period);

      await staking.deposit(getBigNumber(1, 9), alice.address);
      await advanceTime(period);
      const balance0 = await rewardToken.balanceOf(alice.address);
      await staking.connect(alice).harvest(alice.address);
      const balance1 = await rewardToken.balanceOf(alice.address);

      expect(balance1.sub(balance0)).to.be.equal(
        expectedReward.mul(9).div(10)
      );
      expect((await staking.userInfo(alice.address)).rewardDebt).to.be.equal(
        expectedReward
      );
      expect(await staking.pendingReward(alice.address)).to.be.equal(0);
    });

    it("Harvest with empty user balance", async () => {
      await staking.connect(alice).harvest(alice.address);
    });
  });

  describe("Withdraw", () => {
    it("Should give back the correct amount of lp token and harvest rewards(withdraw whole amount)", async () => {
      const depositAmount = getBigNumber(1, 9);
      const period = duration.days(31).toNumber();
      const expectedReward = rewardPerSecond.mul(period);

      await staking.deposit(depositAmount, alice.address);
      await advanceTime(period);
      const balance0 = await rainbow.balanceOf(alice.address);
      await staking.connect(alice).withdraw(depositAmount, alice.address);
      const balance1 = await rainbow.balanceOf(alice.address);

      expect(depositAmount.add(expectedReward)).to.be.equal(balance1.sub(balance0));

      // remainging reward should be zero
      expect(await staking.pendingReward(alice.address)).to.be.equal(0);
      // remaing debt should be zero
      expect((await staking.userInfo(alice.address)).rewardDebt).to.be.equal(0);
    });
  });

  describe("EmergencyWithdraw", () => {
    it("Should emit event EmergencyWithdraw", async () => {
      await staking.deposit(getBigNumber(1, 9), bob.address);
      await expect(staking.connect(bob).emergencyWithdraw(bob.address))
        .to.emit(staking, "EmergencyWithdraw")
        .withArgs(bob.address, getBigNumber(1, 9), getBigNumber(1, 9), bob.address);
    });
  });

  describe("Reward Treasury", () => {
    it("setRewardTreasury - Security/Work", async () => {
      await expect(staking.connect(bob).setRewardTreasury(rewardTreasury.address)).to.be.revertedWith("Ownable: caller is not the owner");
      await staking.setRewardTreasury(rewardTreasury.address);
      expect(await staking.rewardTreasury()).to.be.equal(rewardTreasury.address);
    });

    it("can only spend aproved amount", async () => {
      await rewardToken.connect(rewardTreasury).approve(staking.address, 0);
      await staking.setRewardTreasury(rewardTreasury.address);
      const rewardInfo = await staking.availableReward();
      expect(rewardInfo.rewardInTreasury).to.be.equal(await rewardToken.balanceOf(rewardTreasury.address));
      expect(rewardInfo.rewardAllowedForThisPool).to.be.equal(0);
      
      await rewardToken.connect(rewardTreasury).approve(staking.address, totalRewardAmount);
      expect(await (await staking.availableReward()).rewardAllowedForThisPool).to.be.equal(totalRewardAmount);      
    });

    // it("should fail if allowed amount is small", async () => {
    //   await rewardToken.connect(rewardTreasury).approve(staking.address, 0);
    //   await staking.setRewardTreasury(rewardTreasury.address);

    //   await staking.deposit(getBigNumber(1, 9), alice.address)
    //   await advanceTime(86400 * 40);
    //   await expect(staking.connect(alice).harvest(alice.address)).to.be.reverted;

    //   const rewardAmount = await staking.pendingReward(alice.address);
    //   await rewardToken.connect(rewardTreasury).approve(staking.address, rewardAmount.sub(1));
    //   await expect(staking.connect(alice).harvest(alice.address)).to.be.reverted;

    //   await rewardToken.connect(rewardTreasury).approve(staking.address, totalRewardAmount);
    //   await staking.connect(alice).harvest(alice.address);
    // });
  });

  describe("Renoucne Ownership", () => {
    it("Should revert when call renoucne ownership", async () => {
      await expect(staking.connect(deployer).renounceOwnership()).to.be
        .reverted;
    });
  });
});
