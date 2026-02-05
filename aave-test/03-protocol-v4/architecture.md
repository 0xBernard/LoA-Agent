# Aave V4 Architecture

Aave V4 introduces a radical shift in DeFi lending protocol design, moving from a monolithic structure to a modular **Hub-and-Spoke** architecture.

## Core Design Philosophy

The primary goals of V4 are:
1.  **Capital Efficiency:** Maximizing the utility of assets across the ecosystem.
2.  **Scalability:** Allowing independent innovation without risking the core.
3.  **Risk Management:** Isolating risks to specific "spokes" while sharing liquidity where safe.

## The Unified Liquidity Layer (The Hub)

At the center of Aave V4 is the **Unified Liquidity Layer** (ULL).
*   **Role:** It acts as the central registry and settlement layer for all liquidity in the system.
*   **Function:** Instead of liquidity being fragmented across different pools (as in V2) or requiring complex bridging, the ULL allows liquidity to be conceptually shared while remaining mathematically accounted for.
*   **Benefit:** This solves the "fragmented liquidity" problem, where V3 pools on different chains or with different configurations split the community's lending power.

## Hub-and-Spoke Model

Surrounding the ULL are the **Spokes**.

### The Hub
*   Manages the total liquidity.
*   Does *not* hold business logic for lending or borrowing.
*   Immutable and minimal attack surface.

### The Spokes
*   Implement specific features (e.g., a "Lending Spoke", "RWA Spoke", "Institutional Spoke").
*   Can have their own risk configurations.
*   **Isolation:** A hack or failure in one Spoke does not necessarily drain the Hub if proper isolation limits are enforced.
*   **Innovation:** Developers can build custom Spokes (e.g., undercollateralized lending, fixed-rate lending) that tap into Aave's liquidity without requiring a full protocol upgrade.

## Key Technical Components

*   **`src/` Directory:** Contains the core logic.
    *   **Hub:** The central contract.
    *   **Spokes:** Reference implementations of spokes.
    *   **Position Managers:** Helpers for managing user positions.
*   **Dependencies:** Managed strictly within `src/dependencies` to prevent supply chain attacks.
