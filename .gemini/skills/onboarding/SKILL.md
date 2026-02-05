---
name: repo-walker
description: Analyze a protocol repository to build technical understanding and map governance-relevant code. Use when onboarding a new protocol.
---

# Repository Walker Skill

You are analyzing a protocol's codebase to build a technical map that will inform documentation. This is reconnaissance - creating a foundation for understanding the protocol's architecture.

## Input

You will receive JSON data via stdin containing:
- `protocolId`: Protocol ID
- `repoPath`: Local path to cloned repo
- `repoUrl`: Original GitHub URL
- `overview`: Pre-computed repo overview (hasContracts, hasReadme, mainLanguage, etc.)

## Analysis Tasks

### 1. Structure Mapping
Understand the repository layout:
- Project type (solidity-foundry, solidity-hardhat, rust-anchor, etc.)
- Core directories (contracts, interfaces, libraries, tests)
- Configuration files
- Documentation files

### 2. Contract/Module Analysis
For major contracts:
- Name and path
- Purpose (inferred from name, comments, code)
- Key public/external functions
- Governance-relevant functions (admin, owner, parameter setters)
- Upgrade patterns

### 3. Governance Surface
Identify governance-relevant code:
- Admin/owner functions
- Parameter setters
- Access control patterns
- Timelock or multisig integrations

### 4. Documentation Extraction
Note useful documentation found:
- README content
- Architecture docs
- NatSpec quality

## Output Format

Return a JSON object with this exact structure:

```json
{
  "technicalSummary": "# Technical Summary: Protocol Name\n\n## Repository Overview\n...",
  "projectType": "solidity-foundry",
  "structure": {
    "contractsPath": "src/",
    "interfacesPath": "src/interfaces/",
    "testsPath": "test/",
    "configFiles": ["foundry.toml", "remappings.txt"]
  },
  "contracts": [
    {
      "name": "Pool",
      "path": "src/Pool.sol",
      "purpose": "Main lending pool contract",
      "sizeBytes": 45000,
      "hasGovernanceFunctions": true,
      "governanceFunctions": ["setReserveConfiguration", "setLTV"],
      "isUpgradeable": true,
      "upgradePattern": "TransparentProxy"
    }
  ],
  "governanceSurface": {
    "accessControlPattern": "AccessControl",
    "adminRoles": ["POOL_ADMIN", "RISK_ADMIN", "EMERGENCY_ADMIN"],
    "hasTimelock": true,
    "keyParameters": [
      {
        "name": "reserveFactor",
        "location": "Pool",
        "description": "Protocol fee percentage"
      }
    ]
  },
  "documentation": {
    "hasReadme": true,
    "readmeSummary": "Brief summary of what README contains...",
    "hasArchitectureDocs": false,
    "natspecQuality": "good"
  },
  "gaps": [
    "Detailed function analysis pending",
    "Governance role mapping incomplete"
  ],
  "sourceDocsToSave": [
    {
      "sourceType": "README",
      "title": "README",
      "content": "Full README content here...",
      "sourceUrl": "https://github.com/org/repo/blob/main/README.md"
    }
  ]
}
```

## Guidelines

### Project Type Detection
- `foundry.toml` → solidity-foundry
- `hardhat.config.js/ts` → solidity-hardhat
- `Anchor.toml` → rust-anchor
- `Move.toml` → move
- `Scarb.toml` → cairo

### Governance Function Signals
Look for: `onlyOwner`, `onlyAdmin`, `onlyGovernance`, `onlyRole`, `requiresAuth`
Common patterns: `set*`, `update*`, `configure*`, `pause`, `unpause`

### Upgrade Pattern Detection
- TransparentProxy: Look for `upgradeTo`, proxy admin patterns
- UUPS: `_authorizeUpgrade` function
- Beacon: `BeaconProxy` imports

### Technical Summary Format
Generate markdown that covers:
- Repository overview (URL, language, framework)
- Architecture (core contracts table, relationships)
- Governance surface (admin functions, access control)
- Key parameters
- External dependencies
- Documentation found
- Gaps and unknowns

## Example Output

```json
{
  "technicalSummary": "# Technical Summary: Aave V3\n\n## Repository Overview\n- **URL**: https://github.com/aave/aave-v3-core\n- **Primary Language**: Solidity\n- **Framework**: Foundry\n\n## Architecture\n\n### Core Contracts\n| Contract | Purpose | Governance Functions |\n|----------|---------|---------------------|\n| Pool | Main lending pool | setReserveConfiguration |\n| PoolConfigurator | Admin interface | All parameter setters |\n\n## Governance Surface\n- **Access Control**: Role-based (ACLManager)\n- **Admin Roles**: POOL_ADMIN, RISK_ADMIN, EMERGENCY_ADMIN\n- **Timelock**: Yes, via governance executor\n\n## Key Parameters\n| Parameter | Contract | Description |\n|-----------|----------|-------------|\n| LTV | PoolConfigurator | Loan-to-value ratios |\n| Reserve Factor | Pool | Protocol fee % |\n\n## Gaps\n- Detailed function signatures pending\n- Cross-contract dependency mapping needed",
  "projectType": "solidity-foundry",
  "structure": {
    "contractsPath": "src/",
    "interfacesPath": "src/interfaces/",
    "testsPath": "test/",
    "configFiles": ["foundry.toml"]
  },
  "contracts": [
    {
      "name": "Pool",
      "path": "src/protocol/pool/Pool.sol",
      "purpose": "Core lending pool - deposits, borrows, liquidations",
      "sizeBytes": 52000,
      "hasGovernanceFunctions": true,
      "governanceFunctions": ["setReserveConfiguration"],
      "isUpgradeable": true,
      "upgradePattern": "TransparentProxy"
    }
  ],
  "governanceSurface": {
    "accessControlPattern": "ACLManager (custom role-based)",
    "adminRoles": ["POOL_ADMIN", "RISK_ADMIN", "EMERGENCY_ADMIN", "ASSET_LISTING_ADMIN"],
    "hasTimelock": true,
    "keyParameters": [
      {
        "name": "LTV",
        "location": "PoolConfigurator",
        "description": "Loan-to-value ratios per asset"
      }
    ]
  },
  "documentation": {
    "hasReadme": true,
    "readmeSummary": "Comprehensive README with architecture overview, deployment instructions, and links to docs",
    "hasArchitectureDocs": true,
    "natspecQuality": "excellent"
  },
  "gaps": [
    "Oracle integration details not fully mapped",
    "Interest rate strategy contracts need analysis"
  ],
  "sourceDocsToSave": [
    {
      "sourceType": "README",
      "title": "Aave V3 Core README",
      "content": "# Aave Protocol V3\n\nThis repository contains the core smart contracts...",
      "sourceUrl": "https://github.com/aave/aave-v3-core/blob/main/README.md"
    }
  ]
}
```

Return ONLY the JSON object. No markdown code blocks, no explanations.
