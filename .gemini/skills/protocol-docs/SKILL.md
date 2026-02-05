---
name: protocol-docs
description: Transform source documentation into Library of Alexandria format with governance context. Use when generating documentation pages.
---

# Protocol Documentation Skill

You are transforming protocol documentation from various sources (official docs, READMEs, forum discussions) into the Library of Alexandria's format. This is primarily a **transformation** task, not creative writing.

## Input

You will receive JSON data via stdin containing:
- `protocolId`: The protocol to document
- `sourceDoc`: A source document to transform (title, content, sourceType, sourceUrl)
- `targetPath`: The target page path in LoA structure
- `pageType`: One of 'overview' | 'feature' | 'technical' | 'governance'
- `entities`: Summary of known entities (service providers, delegates)
- `protocolContext`: Current governance state

## Key Principle: Transform, Don't Invent

- Reorganize and clarify existing documentation
- Add governance context and cross-references
- Maintain accuracy - quote sources when uncertain
- Flag gaps rather than filling with speculation

## Output Format

Return a JSON object with this exact structure:

```json
{
  "page": {
    "title": "Page Title",
    "path": "aave/features/flash-loans",
    "content": "# Flash Loans\n\nFull markdown content here...",
    "pageType": "feature"
  },
  "metadata": {
    "sourceDocIds": ["source-doc-id-1"],
    "crossReferences": [
      {"path": "aave/governance/entities/chaoslabs", "context": "Risk analysis provider"}
    ],
    "governanceRelevance": "Parameters can be modified via governance",
    "accuracyNotes": ["Current values from source dated 2026-01-10"]
  },
  "shouldDraft": true,
  "draftReason": "New page with significant content requiring review"
}
```

## Page Templates

### Overview Page (`pageType: 'overview'`)
```markdown
# {Protocol Name}

{1-2 sentence intro}

## What is {Protocol}?
{Core explanation from source docs}

## Key Features
- **{Feature 1}**: Brief description → [Learn more](/path)
- **{Feature 2}**: Brief description → [Learn more](/path)

## Governance
{Protocol} is governed by {governance structure}.

### Service Providers
{List from entities data}

### Key Delegates  
{List from entities data}

## Getting Started
- [Official Documentation]({external-link})
- [Forum]({forum-link})

---
*Generated from official documentation.*
```

### Feature Page (`pageType: 'feature'`)
```markdown
# {Feature Name}

{What this feature does in 1-2 sentences}

## Overview
{Expanded explanation}

## How It Works
{Technical explanation appropriate to audience}

## Key Parameters
| Parameter | Description | Current Value |
|-----------|-------------|---------------|
| {param} | {desc} | {value} |

## Governance
{How governance interacts with this feature}
- Who can modify parameters?
- Recent proposals affecting this feature

## Risks & Considerations
{From source docs or flagged as gap}

## Related
- [{Related feature}](/path)
- [Official Documentation]({source-url})

---
*Transformed from official documentation. [View source]({source-url})*
```

### Technical Page (`pageType: 'technical'`)
```markdown
# {Technical Topic}

## Architecture
{Contract structure, interactions}

## Key Contracts
| Contract | Purpose | Governance Functions |
|----------|---------|---------------------|
| {name} | {purpose} | {functions} |

## Integration
{How to interact with these contracts}

## Security Considerations
{From audits, docs, or flagged as gap}

---
*Technical documentation. [View source]({source-url})*
```

### Governance Page (`pageType: 'governance'`)
```markdown
# {Governance Topic}

## Overview
{Governance mechanism explanation}

## Process
1. {Step 1}
2. {Step 2}
...

## Key Roles
{From entities - link to profiles}

## Historical Context
{Notable past decisions if in source}

---
*Governance documentation.*
```

## Guidelines

### Preserving Accuracy
```
Source: "The liquidation threshold is set to 85%"
✓ Write: "The liquidation threshold is currently set to 85%"
✗ Don't: "The liquidation threshold is usually around 85%"
```

### Adding Context
```
Source: "Flash loans require no collateral"
✓ Add: "Flash loans require no collateral, as the loan must be repaid within the same transaction. This enables arbitrage, collateral swaps, and self-liquidation strategies."
```

### Flagging Gaps
```markdown
> **Note**: The official documentation does not specify the exact calculation. See [AIP-123]() for details.
```

### Cross-Referencing Entities
```markdown
Risk parameters are managed by [Chaos Labs](/governance/entities/chaoslabs) and [Gauntlet](/governance/entities/gauntlet).
```

### When to Draft
- `shouldDraft: true`: New pages, significant content, governance-heavy
- `shouldDraft: false`: Minor updates, corrections, metadata only

## Example Output

```json
{
  "page": {
    "title": "Flash Loans",
    "path": "aave/features/flash-loans",
    "content": "# Flash Loans\n\nBorrow any available amount of assets without collateral, as long as the liquidity is returned within one transaction.\n\n## Overview\n\nFlash loans are a powerful DeFi primitive unique to blockchain environments. They enable uncollateralized borrowing by requiring the loan to be repaid within the same transaction block.\n\n## How It Works\n\n1. Your contract calls `flashLoan()` on the Pool\n2. Pool transfers requested assets to your contract\n3. Your contract executes arbitrary logic\n4. Your contract repays principal + fee\n5. Transaction completes (or reverts if underpaid)\n\n## Key Parameters\n\n| Parameter | Description | Current Value |\n|-----------|-------------|---------------|\n| Flash Loan Fee | Fee charged on flash loans | 0.09% |\n| Max Flash Loan | Maximum amount per asset | Varies by liquidity |\n\n## Governance\n\nFlash loan parameters can be modified through Aave governance:\n- Fee adjustments require an AIP vote\n- [Risk Service Providers](/aave/governance/service-providers) analyze fee impact\n\n## Use Cases\n\n- **Arbitrage**: Exploit price differences across DEXs\n- **Collateral Swaps**: Change collateral without closing position\n- **Self-Liquidation**: Liquidate your own undercollateralized position\n\n## Risks & Considerations\n\n- Smart contract risk in receiving contract\n- Reverts if repayment fails\n- MEV exposure for profitable operations\n\n## Related\n\n- [Supplying Assets](/aave/features/supplying)\n- [Official Flash Loans Docs](https://docs.aave.com/developers/guides/flash-loans)\n\n---\n*Transformed from official documentation.*",
    "pageType": "feature"
  },
  "metadata": {
    "sourceDocIds": ["src-doc-flash-loans"],
    "crossReferences": [
      {"path": "aave/governance/service-providers", "context": "Risk analysis for fee parameters"}
    ],
    "governanceRelevance": "Flash loan fee is a governance-controlled parameter",
    "accuracyNotes": ["Fee percentage from Aave V3 docs, may vary by deployment"]
  },
  "shouldDraft": true,
  "draftReason": "New feature page with governance integration"
}
```

Return ONLY the JSON object. No markdown code blocks, no explanations.
