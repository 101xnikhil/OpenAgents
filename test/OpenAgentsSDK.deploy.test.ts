import { after, before, describe, it } from "mocha";
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

describe("OpenAgentsSDK.deployContract", function () {
  this.timeout(60000);

  let sdk: OpenAgentsSDK;
  let provider: ethers.JsonRpcProvider;

  const createSDK = () =>
    new OpenAgentsSDK({
      name: "deployment-test-agent",
      endpoint: "http://localhost",
      privateKey: PRIVATE_KEY,
      rpcUrl: RPC_URL,
      registryAddress: ethers.ZeroAddress,
      routerAddress: ethers.ZeroAddress,
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

  it("deploys with constructor arguments and returns deployment metadata", async () => {
    const { abi, bytecode } = compileFixture();

    const result = await sdk.deployContract(
      abi,
      bytecode,
      [42, "OpenAgents"],
      1
    );

    expect(result.contract).to.exist;
    expect(result.receipt.address).to.equal(await result.contract.getAddress());
    expect(result.receipt.transactionHash).to.match(/^0x[0-9a-fA-F]{64}$/);
    expect(result.receipt.gasUsed > 0n).to.be.true;
    expect(result.receipt.blockNumber).to.be.a("number");
    expect(result.receipt.status).to.equal(1);

    const deployed = new ethers.Contract(result.receipt.address, abi, provider);

    expect(await deployed.value()).to.equal(42n);
    expect(await deployed.label()).to.equal("OpenAgents");
  });

  it("deploys without arguments using default parameters", async () => {
    const source = `
      pragma solidity ^0.8.20;
      contract NoArgsFixture {
        uint256 public constant NUMBER = 777;
      }
    `;
    const input = {
      language: "Solidity",
      sources: { "NoArgsFixture.sol": { content: source } },
      settings: {
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const artifact = output.contracts["NoArgsFixture.sol"]["NoArgsFixture"];
    const result = await sdk.deployContract(
      artifact.abi,
      `0x${artifact.evm.bytecode.object}`
    );

    expect(result.contract).to.exist;
    expect(result.receipt.address).to.equal(await result.contract.getAddress());
    expect(result.receipt.status).to.equal(1);

    const deployed = new ethers.Contract(
      result.receipt.address,
      artifact.abi,
      provider
    );
    expect(await deployed.NUMBER()).to.equal(777n);
  });

  it("waits for the requested number of confirmations", async () => {
    sdk = createSDK();

    const { abi, bytecode } = compileFixture();

    const miningInterval = setInterval(async () => {
      try {
        await provider.send("evm_mine", []);
      } catch {
        // Ignore mining errors during test cleanup.
      }
    }, 100);

    try {
      const result = await sdk.deployContract(
        abi,
        bytecode,
        [99, "confirmed"],
        2
      );

      expect(result.receipt.address).to.equal(
        await result.contract.getAddress()
      );
      const currentBlock = await provider.getBlockNumber();
      const confirmations = currentBlock - result.receipt.blockNumber + 1;
      expect(confirmations).to.be.at.least(2);
    } finally {
      clearInterval(miningInterval);
    }
  });

  it("rejects non-positive integer confirmations", async () => {
    const { abi, bytecode } = compileFixture();

    let error: any;
    try {
      await sdk.deployContract(abi, bytecode, [1, "test"], 0);
    } catch (err) {
      error = err;
    }
    expect(error?.message).to.equal("confirmations must be a positive integer");

    let floatError: any;
    try {
      await sdk.deployContract(abi, bytecode, [1, "test"], 1.5);
    } catch (err) {
      floatError = err;
    }
    expect(floatError?.message).to.equal(
      "confirmations must be a positive integer"
    );
  });
});
