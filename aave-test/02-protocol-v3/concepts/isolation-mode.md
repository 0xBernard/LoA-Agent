# Isolation Mode

**Isolation Mode** is a risk management feature in Aave V3 that allows the protocol to list new, potentially volatile assets without exposing the entire liquidity pool to systemic risk.

## How It Works

When a new asset is listed as "Isolated":
1.  **Single Collateral:** Users can *only* use that specific isolated asset as collateral. They cannot mix it with other collateral types (like ETH or WBTC) in the same wallet.
2.  **Restricted Borrowing:** Users can only borrow **Stablecoins** (specifically, those permitted by the DAO for isolation mode, usually USDC, DAI, USDT).
3.  **Debt Ceiling:** The asset has a strict **Debt Ceiling**—a maximum amount of stablecoins that can be borrowed against it protocol-wide.

## Why It Matters

In V2, listing a risky asset meant that if its price went to zero or its oracle was manipulated, an attacker could potentially drain *any* available asset in the protocol.

In V3 with **Isolation Mode**:
*   If the isolated asset collapses, the loss is limited to the specific stablecoin debt ceiling.
*   The main "Blue Chip" pools (ETH, WBTC) remain safe.
*   This allows the Aave DAO to be more aggressive in listing "Long Tail" assets (new tokens, real-world assets) earlier in their lifecycle.

## Exiting Isolation
Once an asset matures (higher liquidity, reliable oracles), Aave Governance can vote to remove the Isolation Mode flag, allowing it to be used as standard collateral alongside other assets.
