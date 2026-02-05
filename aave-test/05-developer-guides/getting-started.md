# Getting Started with Aave Development

This guide will help you interact with the Aave V3 protocol using the official SDK.

## Prerequisites
*   Node.js & npm
*   An Ethereum provider (e.g., Alchemy, Infura)
*   A wallet with testnet funds (e.g., Sepolia ETH)

## Installation

```bash
npm install @aave/contract-helpers @aave/math-utils ethers
```

## Basic Interaction: Supplying Assets

To supply assets (deposit), you interact with the **Pool** contract.

```typescript
import { ethers } from 'ethers';
import { Pool } from '@aave/contract-helpers';

async function supplyAsset() {
  const provider = new ethers.providers.JsonRpcProvider("YOUR_RPC_URL");
  const signer = new ethers.Wallet("YOUR_PRIVATE_KEY", provider);

  // Aave V3 Pool Address (Check docs for your network)
  const POOL_ADDRESS = "0x..."; 
  const USDC_ADDRESS = "0x...";

  const pool = new Pool(provider, {
    POOL: POOL_ADDRESS,
    WETH_GATEWAY: "0x...", 
  });

  const user = await signer.getAddress();
  const amount = "1000000"; // 1 USDC (6 decimals)

  // 1. Generate Approval Transaction (if needed)
  // ... (standard ERC20 approve) ...

  // 2. Generate Supply Transaction
  const supplyTxData = await pool.supply({
    user,
    reserve: USDC_ADDRESS,
    amount,
    onBehalfOf: user,
  });

  // 3. Send Transaction
  const tx = await signer.sendTransaction(supplyTxData[0]);
  await tx.wait();
  
  console.log("Supplied 1 USDC!");
}
```

## Reading User Data

To see your current health factor and balances:

```typescript
import { UiPoolDataProvider } from '@aave/contract-helpers';

// ... setup provider ...

const uiPoolData = new UiPoolDataProvider({
  uiPoolDataProviderAddress: "0x...", // Contract address
  provider,
  chainId: 11155111, // Sepolia
});

const userReserves = await uiPoolData.getUserReservesHumanized({
  user: "0xYourAddress",
});

console.log(userReserves);
```

## Useful Resources
*   [Aave V3 Developers Docs](https://docs.aave.com/developers/)
*   [Aave V3 Deployed Contracts](https://docs.aave.com/developers/deployed-contracts/v3-mainnet)
