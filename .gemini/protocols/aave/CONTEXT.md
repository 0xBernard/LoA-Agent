# Aave Protocol Context

> This file provides essential context about the Aave protocol for the Loa Agent.
> It is loaded with every skill execution to provide relevant background knowledge.
> Keep this file concise (~2-3K tokens) for token efficiency.

## Protocol Overview

**Aave** is a decentralized, non-custodial liquidity protocol where users can participate as depositors or borrowers. Depositors provide liquidity to earn passive income, while borrowers can borrow in an overcollateralized (perpetual) or undercollateralized (one-block liquidity/flash loans) fashion.

- **Token**: AAVE (governance), aTokens (deposit receipts), debt tokens
- **Governance**: Fully decentralized through Aave DAO
- **Snapshot Space**: aave.eth
- **Forum**: https://governance.aave.com

## Key Concepts

### Core Mechanisms
- **Supply/Borrow**: Users supply assets to earn interest, borrow against collateral
- **Interest Rates**: Variable and stable rates, algorithmically determined
- **Health Factor**: Ratio determining liquidation risk (< 1 = liquidatable)
- **Liquidations**: Undercollateralized positions can be liquidated for a bonus

### Advanced Features
- **E-Mode (Efficiency Mode)**: Higher LTV for correlated assets
- **Isolation Mode**: Risk containment for new assets
- **Siloed Borrowing**: Prevents cross-asset risk contamination
- **Credit Delegation**: Delegate borrowing power to others
- **Flash Loans**: Uncollateralized loans within single transaction

## Governance Structure

### Voting Power
- AAVE token holders vote on proposals
- stkAAVE (staked AAVE) also has voting power
- Delegation is supported

### Proposal Lifecycle
1. **ARC (Aave Request for Comments)**: Initial discussion on forum
2. **ARFC (Aave Request for Final Comments)**: Refined proposal
3. **Snapshot Vote**: Temperature check
4. **AIP (Aave Improvement Proposal)**: On-chain vote
5. **Execution**: Via governance contracts

## Key Entities

### Notable Delegates
High-participation delegates with significant voting power (Jan 2026 analysis):

| Delegate | VP (approx) | Known For |
|----------|-------------|-----------|
| 0x57ab...2922 (MarcZellerACI) | 296k | ACI Founder, Governance Lead |
| 0x4da2...70f5 | 2.9M | Top Whale / Early Holder |
| 0xa700...ffc9 | 1.2M | Large Holder |
| 0xf977...acec | 1.2M | Large Holder |
| Michigan Blockchain | < 100k | University DAO (Lower active VP now) |

### Service Providers
Service providers are organizations contracted by Aave DAO to provide services (verified by forum activity):

| Name | Role | Forum Username | Posts (approx) |
|------|------|----------------|----------------|
| Aave Chan Initiative (ACI) | Governance facilitation | ACI / MarcZeller | ~1350+ |
| Chaos Labs | Risk Management | ChaosLabs | ~540 |
| Gauntlet | Risk Management (Offboarded) | Gauntlet / Pauljlei | ~330 (Exit Feb '24) |
| TokenLogic | Treasury | TokenLogic | ~160 |
| LlamaRisk | Risk Assessment | LlamaRisk | ~180 |
| Karpatkey | Treasury | karpatkey_TokenLogic | ~80 |
| Wintermute | Market Maker / Gov | WintermuteGovernance | ~60 |

### Notable Events & Alignment
- **Gauntlet Exit (Feb 2024)**: Gauntlet terminated their relationship with Aave DAO abruptly, citing "inconsistent guidelines" and friction with large stakeholders. They subsequently partnered with Morpho, a move that the Aave community viewed as a major alignment breach.
- **Merit System**: Introduced post-Gauntlet exit to reward "Aave-aligned" behavior and disincentivize usage of competing products (like Morpho).
- **Chaos Labs Expansion**: Following Gauntlet's exit, Chaos Labs became the primary risk management service provider for the DAO.

## Current Governance State

> This section is updated by the agent as it processes forum posts

### Active Discussions
- [Updated automatically by agent]

### Recent Decisions
- [Updated automatically by agent]

## Terminology

| Term | Definition |
|------|------------|
| AIP | Aave Improvement Proposal - formal governance proposal |
| ARC | Aave Request for Comments - initial discussion phase |
| ARFC | Aave Request for Final Comments - refined proposal |
| GHO | Aave's native decentralized stablecoin |
| stkAAVE | Staked AAVE in the Safety Module |
| Safety Module | Insurance fund protecting the protocol |
| aToken | Interest-bearing token representing deposits |
| V3 | Current version of Aave protocol |

## Important Links

- Documentation: https://docs.aave.com
- Governance Forum: https://governance.aave.com
- Snapshot: https://snapshot.org/#/aave.eth
- GitHub: https://github.com/aave

## Content Scope (Agent vs Manual)

**Agent handles:**
- Overview from official docs
- Feature documentation
- Governance process docs
- Entity profiles (delegates, service providers)
- Relationship mapping from forum patterns

**Archivist handles (not agent scope):**
- Legal structure (Avara Group SEZC, Push Labs Ltd, UK FCA licensing)
- Fundraising history (2017 ICO, Three Arrows/ParaFi sale, Blockchain Capital round)
- Corporate filings and registry research



