# Service Provider: Chaos Labs

**Role:** Risk Management & Analytics
**Governance Handle:** `@ChaosLabs`
**Active Since:** ~2022

## Overview
Chaos Labs is a specialized cloud-based simulation and risk management platform. They serve as one of the primary "Risk Stewards" for the Aave DAO. Their core function is to ensure the protocol remains solvent by dynamically adjusting risk parameters based on real-time market data and large-scale agent-based simulations.

## Key Responsibilities
*   **Asset Listings:** Analyzing new assets (LTV, Liquidation Thresholds, Supply Caps) before they are listed.
*   **Parameter Updates:** Routine "Risk Steward" updates to Supply and Borrow caps.
*   **Incentive Optimization:** Analyzing the efficiency of GHO liquidity mining or other incentive programs.
*   **Risk Dashboards:** Maintaining public-facing dashboards for protocol health.

## Recent Reports & Activities
*(Derived from Governance Forum History)*

| Date | Title | Type |
|------|-------|------|
| 2024-09-10 | [ARFC] Risk Parameter Updates - LTV and LT Alignment | Risk Update |
| 2024-09-10 | [ARFC] Risk Parameter Updates - sAVAX LT/LTV Adjustment | Asset Specific |
| 2024-07-22 | [ARFC] Increase USDe Debt Ceiling on V3 Ethereum | Debt Ceiling |
| 2024-07-16 | [ARFC] sAVAX on Aave V3 Avalanche | Asset Specific |
| 2024-05-24 | [ARFC] Aave V3 Risk Parameter Updates | General Update |

## Methodology
Chaos Labs distinguishes itself by using **Agent-Based Simulation (ABS)**. Unlike static spreadsheets, they simulate millions of market scenarios (price crashes, liquidity crunches, whale exits) to stress-test parameters.

## Governance Stance
Chaos Labs typically votes "For" on proposals that align with conservative risk management. They are often the authors of proposals related to:
1.  Reducing LTV for volatile assets.
2.  Freezing markets during bridge exploits.
3.  Optimizing Interest Rate curves (`Slope1`, `Slope2`) to manage utilization rates.
