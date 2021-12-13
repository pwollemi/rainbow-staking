/* eslint-disable no-await-in-loop */
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import chai from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber } from "ethers";
import { CustomToken, RainbowToken, Staking, StakingRegistry } from "../typechain";
import {
  getLatestBlockTimestamp,
  mineBlock,
  advanceTime,
  duration,
  getBigNumber,
  advanceTimeAndBlock,
} from "../helper/utils";
import { deployContract } from "../helper/deployer";

chai.use(solidity);
const { expect } = chai;

describe("Staking Pool", () => {
  let totalSupply: BigNumber;
  let totalRewardAmount: BigNumber;
  
  // to avoid complex calculation of decimals, we set an easy value
  const rewardPerSecond = BigNumber.from("1000000000000");
  
  let staking1: Staking;
  let staking2: Staking;
  let staking3: Staking;
  let staking4: Staking;
  let registry: StakingRegistry;
  let rainbow: RainbowToken;
  
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;

  before(async () => {
    [deployer, alice] = await ethers.getSigners();
  });

  beforeEach(async () => {
    rainbow = <RainbowToken>(
      await deployContract("RainbowToken")
    );
    staking1 = <Staking>await deployContract("Staking", rainbow.address);
    staking2 = <Staking>await deployContract("Staking", rainbow.address);
    staking3 = <Staking>await deployContract("Staking", rainbow.address);
    staking4 = <Staking>await deployContract("Staking", rainbow.address);
    registry = <StakingRegistry>await deployContract("StakingRegistry");
    totalSupply = await rainbow.totalSupply();
    totalRewardAmount = totalSupply.div(10);

    await staking1.setRewardPerSecond(rewardPerSecond);
    await staking2.setRewardPerSecond(rewardPerSecond);
    await staking3.setRewardPerSecond(rewardPerSecond);
    await staking4.setRewardPerSecond(rewardPerSecond);

    await staking1.setRewardTreasury(deployer.address);
    await staking2.setRewardTreasury(deployer.address);
    await staking3.setRewardTreasury(deployer.address);
    await staking4.setRewardTreasury(deployer.address);

    await rainbow.approve(staking1.address, ethers.constants.MaxUint256);
    await rainbow.approve(staking2.address, ethers.constants.MaxUint256);
    await rainbow.approve(staking3.address, ethers.constants.MaxUint256);
    await rainbow.approve(staking4.address, ethers.constants.MaxUint256);

    await rainbow.transfer(alice.address, totalSupply.div(50));
    await rainbow.connect(alice).approve(staking1.address, ethers.constants.MaxUint256);
    await rainbow.connect(alice).approve(staking2.address, ethers.constants.MaxUint256);
    await rainbow.connect(alice).approve(staking3.address, ethers.constants.MaxUint256);
    await rainbow.connect(alice).approve(staking4.address, ethers.constants.MaxUint256);

    await rainbow.excludeFromFee(staking1.address);
    await rainbow.excludeFromFee(staking2.address);
    await rainbow.excludeFromFee(staking3.address);
    await rainbow.excludeFromFee(staking4.address);
    await rainbow.excludeFromFee(alice.address);

    await registry.setStakingContract(staking3.address, 3);
    await registry.setStakingContract(staking4.address, 4);

    await staking1.setRegistry(registry.address);
    await staking2.setRegistry(registry.address);
    await staking3.setRegistry(registry.address);
    await staking4.setRegistry(registry.address);
  });

  describe("Migrate", () => {
    it("Migrate to up, not low", async () => {
      const depositAmount = getBigNumber(1, 9);
      const period = duration.days(31).toNumber();
      const expectedReward = rewardPerSecond.mul(period);

      await staking1.deposit(depositAmount, alice.address);
      await advanceTime(period);
      
      await expect(staking1.connect(alice).migrate(staking2.address)).to.be.revertedWith("Register this pool first!");
      await registry.setStakingContract(staking1.address, 1);
      await expect(staking1.connect(alice).migrate(staking2.address)).to.be.revertedWith("Register this pool first!");
      await registry.setStakingContract(staking2.address, 2);

      await staking1.connect(alice).migrate(staking2.address);
      await staking2.connect(alice).migrate(staking4.address);

      await expect(staking4.connect(alice).migrate(staking3.address)).to.be.revertedWith("Can't migrate to low pools");
    });

    it("Migrate full amount", async () => {
      const depositAmount = getBigNumber(1, 9);
      const period = duration.days(31).toNumber();
      const expectedReward = rewardPerSecond.mul(period);

      await registry.setStakingContract(staking1.address, 1);
      await registry.setStakingContract(staking2.address, 2);

      await staking1.deposit(depositAmount, alice.address);
      await advanceTime(period);
      await staking1.connect(alice).migrate(staking2.address);

      expect((await staking2.userInfo(alice.address)).amount).to.be.equal(depositAmount.add(expectedReward));
    });
  });
});
