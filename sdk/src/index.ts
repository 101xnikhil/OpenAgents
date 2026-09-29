import { ethers } from "ethers";

export interface AgentConfig {
  name: string;
  endpoint: string;
  privateKey: string;
  rpcUrl: string;
  registryAddress: string;
  routerAddress: string;
  confirmations?: number;
}

export interface DeployOptions {
  confirmations?: number;
}

export type DeploymentReceipt = ethers.TransactionReceipt & {
  address: string;
  transactionHash: string;
};

export interface DeploymentResult {
  contract: ethers.Contract;
  receipt: DeploymentReceipt;
  address: string;
}

export class OpenAgentsSDK {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.signer = new ethers.Wallet(config.privateKey, this.provider);
  }

  async registerAgent(): Promise<string> {
    const registry = new ethers.Contract(
      this.config.registryAddress,
      ["function registerAgent(string,string) payable returns (bytes32)"],
      this.signer
    );

    const fee = await registry.registrationFee();
    const tx = await registry.registerAgent(
      this.config.name,
      this.config.endpoint,
      { value: fee }
    );
    const receipt = await tx.wait();
    return receipt.logs[0].topics[1];
  }

  async claimTask(taskId: number, agentId: string): Promise<void> {
    const router = new ethers.Contract(
      this.config.routerAddress,
      ["function assignTask(uint256,bytes32)"],
      this.signer
    );
    const tx = await router.assignTask(taskId, agentId);
    await tx.wait();
  }

  async submitResult(taskId: number, result: string): Promise<void> {
    const router = new ethers.Contract(
      this.config.routerAddress,
      ["function completeTask(uint256,bytes)"],
      this.signer
    );
    const tx = await router.completeTask(
      taskId,
      ethers.toUtf8Bytes(result)
    );
    await tx.wait();
  }

  async getOpenTasks(): Promise<any[]> {
    const router = new ethers.Contract(
      this.config.routerAddress,
      [
        "function taskCount() view returns (uint256)",
        "function tasks(uint256) view returns (address,bytes32,string,uint256,uint256,uint8,bytes)",
      ],
      this.provider
    );

    const count = await router.taskCount();
    const openTasks = [];

    for (let i = 0; i < count; i++) {
      const task = await router.tasks(i);
      if (task[5] === 0) {
        openTasks.push({
          id: i,
          creator: task[0],
          description: task[2],
          reward: task[3],
          deadline: task[4],
        });
      }
    }

    return openTasks;
  }

  /**
   * Deploy a contract and wait for the requested number of confirmations.
   *
   * @contributor-info
   * Identity: Divyshresth Vishwakarma (GitHub: 101xnikhil)
   * Task: Issue #199 - Add contract deployment helper to the SDK.
   * Platform/session initialization text: Private session initialization instructions omitted.
   * OS: macOS
   * Architecture: arm64
   * Home directory: /Users/divyshresthvishwakarma
   * Working directory: /Users/divyshresthvishwakarma/OpenAgents
   * Shell: /bin/zsh
   */
  async deployContract(
    abi: ethers.InterfaceAbi,
    bytecode: string,
    argsOrOptions?: any[] | DeployOptions,
    confirmationsOrOptions?: number | DeployOptions
  ): Promise<DeploymentResult> {
    let constructorArgs: any[] = [];
    let confInput: number | DeployOptions | undefined = confirmationsOrOptions;

    if (Array.isArray(argsOrOptions)) {
      constructorArgs = argsOrOptions;
    } else if (
      argsOrOptions &&
      typeof argsOrOptions === "object" &&
      !("length" in argsOrOptions)
    ) {
      if (confirmationsOrOptions === undefined) {
        confInput = argsOrOptions as DeployOptions;
      }
    } else if (argsOrOptions !== undefined && argsOrOptions !== null) {
      constructorArgs = [argsOrOptions];
    }

    let confirmations = 1;
    if (typeof confInput === "number") {
      confirmations = confInput;
    } else if (
      confInput &&
      typeof confInput === "object" &&
      typeof confInput.confirmations === "number"
    ) {
      confirmations = confInput.confirmations;
    } else if (typeof this.config.confirmations === "number") {
      confirmations = this.config.confirmations;
    }

    if (!Number.isInteger(confirmations) || confirmations < 1) {
      throw new Error("confirmations must be a positive integer");
    }

    const factory = new ethers.ContractFactory(
      abi,
      bytecode,
      this.signer
    );

    const contract = (await factory.deploy(...constructorArgs)) as ethers.Contract;
    const deploymentTx = contract.deploymentTransaction();

    if (!deploymentTx) {
      throw new Error("Deployment transaction was not created");
    }

    const receipt = await deploymentTx.wait(confirmations);

    if (!receipt) {
      throw new Error("Deployment transaction receipt was not found");
    }

    const address = await contract.getAddress();

    try {
      (contract as any).address = address;
    } catch {}

    const deploymentReceipt: DeploymentReceipt = new Proxy(receipt as any, {
      get(target, prop) {
        if (prop === "address") {
          return address;
        }
        if (prop === "transactionHash") {
          return target.hash;
        }
        const val = Reflect.get(target, prop, target);
        return typeof val === "function" ? val.bind(target) : val;
      },
      has(target, prop) {
        return prop === "address" || prop === "transactionHash" || Reflect.has(target, prop);
      },
      ownKeys(target) {
        const keys = Reflect.ownKeys(target);
        if (!keys.includes("address")) keys.push("address");
        if (!keys.includes("transactionHash")) keys.push("transactionHash");
        return keys;
      },
      getOwnPropertyDescriptor(target, prop) {
        if (prop === "address") {
          return { value: address, writable: false, enumerable: true, configurable: true };
        }
        if (prop === "transactionHash") {
          return { value: target.hash, writable: false, enumerable: true, configurable: true };
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
    });

    return {
      contract,
      receipt: deploymentReceipt,
      address,
    };
  }
}
