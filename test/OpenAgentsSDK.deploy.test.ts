import { after, before, describe, it } from "mocha";
import { expect } from "chai";
import { ethers } from "ethers";
const solc: any = require("solc");
import { OpenAgentsSDK } from "../sdk/src/index";

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

  if (output.errors) {
    const errors = output.errors.filter(
      (error: any) => error.severity === "error"
    );

    if (errors.length) {
      throw new Error(errors.map((error: any) => error.formattedMessage).join("\n"));
    }
  }

  const contract = output.contracts["DeploymentFixture.sol"]["DeploymentFixture"];

  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}

describe("OpenAgentsSDK.deployContract", function () {
  this.timeout(60000);

  let sdk: OpenAgentsSDK;
  let provider: ethers.JsonRpcProvider;

  before(function () {
    provider = new ethers.JsonRpcProvider(RPC_URL);

    sdk = createSDK();
  });

  after(async function () {
    await provider.destroy();
  });

  const createSDK = () =>
    new OpenAgentsSDK({
      name: "deployment-test-agent",
      endpoint: "http://localhost",
      privateKey: PRIVATE_KEY,
      rpcUrl: RPC_URL,
      registryAddress: ethers.ZeroAddress,
      routerAddress: ethers.ZeroAddress,
    });

  it("deploys a contract with constructor arguments and returns deployment metadata", async function () {
    const { abi, bytecode } = compileFixture();

    const value = 42;
    const label = "OpenAgents";

    const result = await sdk.deployContract(
      abi,
      bytecode,
      [value, label],
      1
    );

    expect(result.contract).to.exist;
    expect(result.receipt.address).to.equal(await result.contract.getAddress());
    expect(result.receipt.transactionHash).to.match(/^0x[0-9a-fA-F]{64}$/);
    expect(result.receipt.gasUsed > 0n).to.equal(true);

    const deployed = new ethers.Contract(
      result.receipt.address,
      abi,
      provider
    );

    expect(await deployed.value()).to.equal(BigInt(value));
    expect(await deployed.label()).to.equal(label);
  });

  it("waits for the requested number of confirmations", async function () {
    sdk = createSDK();
    const { abi, bytecode } = compileFixture();

    const miningInterval = setInterval(async () => {
      try {
        await provider.send("evm_mine", []);
      } catch {}
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
    } finally {
      clearInterval(miningInterval);
    }
  });
});
