# Portals

**Portals** is a powerful feature in Aave V3 that enables "cross-chain" liquidity teleportation. It allows whitelisted bridges (Ports) to move supplied assets from one Aave deployment (e.g., Ethereum) to another (e.g., Arbitrum) almost instantly.

## How It Works

1.  **Burn:** A user on the source chain (e.g., Ethereum) requests a transfer via a Bridge (Port). The Bridge burns the user's `aTokens` (e.g., `aUSDC`) on Ethereum.
2.  **Mint:** The Bridge calls the `mintUnbacked()` function on the destination chain (e.g., Arbitrum). This mints `aUSDC` to the user's address on Arbitrum *before* the underlying USDC has actually arrived across the bridge.
3.  **Backing:** The user can immediately use this `aUSDC` (to borrow or earn interest).
4.  **Settlement:** When the Bridge settles the underlying assets (minutes or hours later), they are supplied to the Aave pool on Arbitrum to "back" the unbacked aTokens, resolving the temporary debt.

## Whitelisted Bridges (Ports)
Only trusted bridges approved by Aave Governance can be "Ports". Common examples include:
*   Connext
*   Hop Protocol

## Use Cases
*   **Instant Strategy Migration:** Move a yield farming position from Polygon to Optimism in seconds.
*   **Cross-Chain Arbitrage:** Quickly move liquidity to where borrowing rates are highest.
