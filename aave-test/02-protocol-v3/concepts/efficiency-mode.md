# Efficiency Mode (E-Mode)

**Efficiency Mode** (or "E-Mode") is a feature in Aave V3 designed to maximize capital efficiency for borrowers who use correlated assets.

## How It Works

When a user enables E-Mode for a specific category of assets, they unlock higher borrowing power (LTV) for assets *within that same category*.

### Categories
E-Mode groups assets into categories based on their price correlation. Common categories include:
1.  **Stablecoins:** DAI, USDC, USDT, GHO.
2.  **ETH Correlated:** WETH, wstETH, rETH.
3.  **BTC Correlated:** WBTC, tBTC.

### The Benefit
Normally, borrowing USDC against DAI might require a 75-80% LTV to account for potential de-pegging volatility.
In **E-Mode**:
*   Because DAI and USDC are highly correlated (both track USD), the risk of divergence is lower.
*   Aave allows LTVs as high as **90-97%**.
*   **Liquidation Thresholds** are also tighter (e.g., 98%).

## Use Cases
*   **High Leverage Forex:** Borrowing Euro-pegged coins against USD-pegged coins.
*   **Yield Farming:** Looping Liquid Staking Tokens (LSTs). For example, supply `wstETH`, borrow `ETH`, swap for more `wstETH`, repeat. E-Mode makes this capital efficient with low liquidation risk.

## Restrictions
*   **Category Lock:** When E-Mode is active for a category (e.g., "Stablecoins"), you can **only** borrow other assets from that category.
*   To borrow an asset *outside* the category (e.g., supply USDC to borrow WBTC), you must exit E-Mode.
