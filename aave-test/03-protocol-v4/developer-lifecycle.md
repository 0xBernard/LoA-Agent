# Spokes Developer Lifecycle

With Aave V4, the "Spoke" architecture allows external developers to build on top of Aave's liquidity. The **Spokes Developer Lifecycle** is a governance-approved path for taking a Spoke from idea to Mainnet.

## Phases of Development

### 1. Research & Experimentation
*   **Goal:** Validate the idea.
*   **Environment:** Testnet or Local Simulation.
*   **Action:** Developers fork the V4 repo or use the V4 SDK to build a prototype Spoke.

### 2. Proposal & Governance Check
*   **Goal:** Get community buy-in.
*   **Action:** Post a "TEMP CHECK" on the governance forum.
*   **Content:** Explain the Spoke's utility, risk profile, and required liquidity.

### 3. Testnet Launch & Audit
*   **Goal:** Security and stability.
*   **Action:** Deploy to a public testnet (e.g., Sepolia).
*   **Requirement:** Professional audits are typically required before Mainnet consideration.

### 4. Mainnet Launch (The "Genesis" Spoke)
*   **Goal:** Initial liquidity.
*   **Governance:** An AIP (Aave Improvement Proposal) is voted on to "whitelist" the Spoke in the Hub.
*   **Caps:** Initial Spokes often launch with strict Supply/Borrow caps (Isolation Mode) to limit risk.

### 5. Growth & Maintenance
*   **Goal:** Scale up.
*   **Action:** As the Spoke proves stability, subsequent AIPs can increase caps and integrate it more deeply (e.g., enabling E-Mode).
*   **Support:** The DAO provides long-term support incentives for reliable maintainers.

## Comparisons

*   **Uniswap V4 Hooks:** Similar to Hooks, Spokes allow customization. However, Spokes in Aave manage *liquidity state*, making them more powerful but higher risk.
*   **Chainlink:** The lifecycle draws inspiration from Chainlink's rigorous integration standards for ensuring oracle reliability.
