# Risk Stewards

**Risk Stewards** are smart contracts that allow for automated, rapid updates to Aave's risk parameters without requiring a full governance vote for every minor change.

## The Problem
Aave V2 required a full AIP (Aave Improvement Proposal) and on-chain vote (taking 5-7 days) to update parameters like **Supply Caps** or **Borrow Caps**. In volatile markets, this is too slow.

## The Solution: Aave Risk Stewards (V3)
The DAO delegates limited power to a "Risk Steward" smart contract.
*   **Controlled By:** Often a Multi-Sig of Service Providers (e.g., Chaos Labs, Gauntlet) or an automated "Edge Risk Oracle".
*   **Strict Bounds:** The Steward can only change parameters within strict bounds defined by the DAO (e.g., "Max +10% increase every 5 days").

## Manageable Parameters
1.  **Supply & Borrow Caps:** Adjusted frequently to accommodate user demand while limiting exposure.
2.  **Interest Rates:** adjusting `Slope 1`, `Slope 2` (base rates) to maintain optimal utilization.
3.  **Liquidation Thresholds:** (Rarely changed by Stewards, usually Governance).

## Operations
*   **Automated Updates:** Chaos Labs runs "Risk Oracles" that monitor on-chain volatility and liquidity.
*   **Injection:** When a cap is hit (e.g., "USDC Supply Cap reached"), the Oracle triggers the Risk Steward contract to bump the cap by the allowed amount (e.g., 5%) instantly.
*   **Safety:** The `minDelay` ensures the Steward cannot spam updates, and `maxPercentChange` prevents it from making dangerous drastic changes.
