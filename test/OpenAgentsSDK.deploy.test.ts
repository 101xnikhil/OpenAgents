import { after, before, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import { ethers } from "ethers";
import { OpenAgentsSDK } from "../sdk/src/index";
// @ts-ignore
import solc from "solc";

const RPC_URL = "http://127.0.0.1:8545";
const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function compileFixture() {
  const source = `
    pragma solidity ^0.8.20;

    contract DeploymentFixture {
      uint256 public value;
      string public label;

      constructor(uint256 _value, string memory _label) {
        value = _value;
        label = _label;
      }
    }
  `;

  const input = {
    language: "Solidity",
    sources: {
      "DeploymentFixture.sol": {
        content: source,
      },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  const errors =
    output.errors?.filter(
      (error: { severity: string }) => error.severity === "error"
    ) ?? [];

  if (errors.length > 0) {
    throw new Error(
      errors
        .map((error: { formattedMessage: string }) => error.formattedMessage)
        .join("\n")
    );
  }

  const artifact =
    output.contracts["DeploymentFixture.sol"]["DeploymentFixture"];

  return {
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
  };
}

function compileNoArgsFixture() {
  const source = `
    pragma solidity ^0.8.20;

    contract NoArgsFixture {
      uint256 public constant NUMBER = 777;
    }
  `;

  const input = {
    language: "Solidity",
    sources: {
      "NoArgsFixture.sol": {
        content: source,
      },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const artifact = output.contracts["NoArgsFixture.sol"]["NoArgsFixture"];

  return {
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
  };
}

describe("OpenAgentsSDK.deployContract", function () {
  this.timeout(60000);

  let sdk: OpenAgentsSDK;
  let provider: ethers.JsonRpcProvider;

  const createSDK = (confirmations?: number) =>
    new OpenAgentsSDK({
      name: "deployment-test-agent",
      endpoint: "http://localhost",
      privateKey: PRIVATE_KEY,
      rpcUrl: RPC_URL,
      registryAddress: ethers.ZeroAddress,
      routerAddress: ethers.ZeroAddress,
      ...(confirmations !== undefined ? { confirmations } : {}),
    });

  before(() => {
    provider = new ethers.JsonRpcProvider(RPC_URL);
  });

  beforeEach(() => {
    sdk = createSDK();
  });

  after(async () => {
    await provider.destroy();
  });

  it("TEST 1: deploys contract with constructor arguments and verifies state and receipt", async () => {
    const { abi, bytecode } = compileFixture();
    const expectedValue = 42;
    const expectedLabel = "OpenAgents";

    const result = await sdk.deployContract(
      abi,
      bytecode,
      [expectedValue, expectedLabel],
      1
    );

    // Verify returned contract and address
    expect(result.contract).to.exist;
    expect(result.address).to.be.a("string");
    expect(ethers.isAddress(result.address)).to.be.true;
    expect(await result.contract.getAddress()).to.equal(result.address);

    // Verify receipt address and transaction hash
    expect(result.receipt.address).to.equal(result.address);
    expect(result.receipt.transactionHash).to.match(/^0x[0-9a-fA-F]{64}$/);
    expect(result.receipt.transactionHash).to.equal(result.receipt.hash);

    // Verify gasUsed, blockNumber, and status
    expect(result.receipt.gasUsed > 0n).to.be.true;
    expect(result.receipt.blockNumber).to.be.a("number");
    expect(result.receipt.blockNumber).to.be.greaterThan(0);
    expect(result.receipt.status).to.equal(1);

    // Verify deployed contract state matches constructor arguments
    const deployed = new ethers.Contract(result.address, abi, provider);
    expect(await deployed.value()).to.equal(BigInt(expectedValue));
    expect(await deployed.label()).to.equal(expectedLabel);
  });

  it("TEST 2: deploys contract without constructor arguments when args are omitted or defaulted", async () => {
    const { abi, bytecode } = compileNoArgsFixture();

    // Deploy with args omitted
    const result = await sdk.deployContract(abi, bytecode);

    expect(result.contract).to.exist;
    expect(result.address).to.be.a("string");
    expect(ethers.isAddress(result.address)).to.be.true;
    expect(result.receipt.address).to.equal(result.address);
    expect(result.receipt.status).to.equal(1);

    const deployed = new ethers.Contract(result.address, abi, provider);
    expect(await deployed.NUMBER()).to.equal(777n);
  });

  it("TEST 3: supports configurable confirmation count via argument, options, and SDK config", async () => {
    const { abi, bytecode } = compileFixture();

    const miningInterval = setInterval(async () => {
      try {
        await provider.send("evm_mine", []);
      } catch {
        // Ignore mining errors during cleanup
      }
    }, 50);

    try {
      // 3A: Explicit confirmation count as number argument >= 2
      const resultArg = await sdk.deployContract(
        abi,
        bytecode,
        [101, "arg-confirmed"],
        2
      );
      expect(resultArg.receipt.address).to.equal(resultArg.address);
      const currentBlockAfterArg = await provider.getBlockNumber();
      const confirmationsArg = currentBlockAfterArg - resultArg.receipt.blockNumber + 1;
      expect(confirmationsArg).to.be.at.least(2);

      // 3B: Configurable via options object
      const resultOpt = await sdk.deployContract(
        abi,
        bytecode,
        [102, "opt-confirmed"],
        { confirmations: 2 }
      );
      expect(resultOpt.receipt.address).to.equal(resultOpt.address);
      const currentBlockAfterOpt = await provider.getBlockNumber();
      const confirmationsOpt = currentBlockAfterOpt - resultOpt.receipt.blockNumber + 1;
      expect(confirmationsOpt).to.be.at.least(2);

      // 3C: Configurable via SDK configuration
      const sdkWithConf = createSDK(2);
      const resultSdkConf = await sdkWithConf.deployContract(
        abi,
        bytecode,
        [103, "sdk-conf-confirmed"]
      );
      expect(resultSdkConf.receipt.address).to.equal(resultSdkConf.address);
      const currentBlockAfterSdk = await provider.getBlockNumber();
      const confirmationsSdk = currentBlockAfterSdk - resultSdkConf.receipt.blockNumber + 1;
      expect(confirmationsSdk).to.be.at.least(2);
    } finally {
      clearInterval(miningInterval);
    }
  });

  it("TEST 4: rejects invalid confirmation configuration (zero, negative, non-integer)", async () => {
    const { abi, bytecode } = compileFixture();

    // Zero confirmations
    let errZero: any;
    try {
      await sdk.deployContract(abi, bytecode, [1, "test"], 0);
    } catch (err) {
      errZero = err;
    }
    expect(errZero?.message).to.equal("confirmations must be a positive integer");

    // Negative confirmations
    let errNeg: any;
    try {
      await sdk.deployContract(abi, bytecode, [1, "test"], -1);
    } catch (err) {
      errNeg = err;
    }
    expect(errNeg?.message).to.equal("confirmations must be a positive integer");

    // Float / non-integer confirmations
    let errFloat: any;
    try {
      await sdk.deployContract(abi, bytecode, [1, "test"], 1.5);
    } catch (err) {
      errFloat = err;
    }
    expect(errFloat?.message).to.equal("confirmations must be a positive integer");

    // Invalid confirmation in options object
    let errOpt: any;
    try {
      await sdk.deployContract(abi, bytecode, [1, "test"], { confirmations: 0 });
    } catch (err) {
      errOpt = err;
    }
    expect(errOpt?.message).to.equal("confirmations must be a positive integer");

    // Invalid confirmation in SDK configuration
    const invalidSdk = createSDK(0);
    let errSdkConf: any;
    try {
      await invalidSdk.deployContract(abi, bytecode, [1, "test"]);
    } catch (err) {
      errSdkConf = err;
    }
    expect(errSdkConf?.message).to.equal("confirmations must be a positive integer");
  });

  it("TEST 5: asserts complete receipt metadata without data loss", async () => {
    const { abi, bytecode } = compileFixture();

    const result = await sdk.deployContract(
      abi,
      bytecode,
      [999, "full-receipt-test"],
      1
    );

    const receipt = result.receipt;

    // Core receipt properties required by issue
    expect(receipt.address).to.be.a("string");
    expect(ethers.isAddress(receipt.address)).to.be.true;
    expect(receipt.transactionHash).to.be.a("string");
    expect(receipt.transactionHash).to.match(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.gasUsed).to.be.a("bigint");
    expect(receipt.gasUsed > 0n).to.be.true;

    // Complete transaction receipt metadata preserved
    expect(receipt.blockNumber).to.be.a("number");
    expect(receipt.blockNumber).to.be.greaterThan(0);
    expect(receipt.blockHash).to.be.a("string");
    expect(receipt.blockHash).to.match(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).to.equal(1);
    expect(receipt.cumulativeGasUsed).to.be.a("bigint");
    expect(receipt.cumulativeGasUsed > 0n).to.be.true;
    expect(Array.isArray(receipt.logs)).to.be.true;

    // Parity between ethers receipt fields and helper fields
    expect(receipt.hash).to.equal(receipt.transactionHash);
    expect(receipt.contractAddress).to.equal(receipt.address);
    expect(result.address).to.equal(receipt.address);
  });
});
