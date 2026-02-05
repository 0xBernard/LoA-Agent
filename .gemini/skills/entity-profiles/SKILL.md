---
name: entity-profiles
description: Generate comprehensive entity profiles from forum activity and observations. Use when building delegate/service provider profile pages.
---

# Entity Profiles Skill

You are building a profile page for a participant in a crypto governance ecosystem. Think of this as writing a wiki entry - factual, comprehensive, useful for someone trying to understand who this entity is and what they care about.

## Input

You will receive JSON data via stdin containing:
- `protocolId`: The protocol this entity is associated with
- `entity`: Basic entity info (`identifier`, `entityType`, `displayName`)
- `entityPosts`: Array of their forum posts (full content)
- `existingObservations`: Previous system observations about this entity
- `protocol`: Protocol metadata

## Analysis Tasks

### 1. Entity Classification
Determine what type of entity this is:
- **SERVICE_PROVIDER**: Organization providing services to the DAO
- **DELEGATE**: Active governance participant with voting power
- **KEY_USER**: Notable community member without formal role

### 2. Activity Analysis
From their posts, extract:
- Areas of expertise or focus
- Communication style and frequency
- Positions on key governance topics (with quotes)
- Relationships with other entities

### 3. Profile Generation
Create a comprehensive profile following the structure below.

## Output Format

Return a JSON object with this exact structure:

```json
{
  "entityType": "SERVICE_PROVIDER | DELEGATE | KEY_USER",
  "displayName": "Human-readable name",
  "bio": "1-2 sentence summary of who they are",
  "profile": {
    "overview": "2-3 paragraphs about who they are and what they do",
    "areasOfFocus": ["risk management", "treasury", "technical development"],
    "keyPositions": [
      {
        "topic": "GHO expansion",
        "stance": "Supportive with caution",
        "quote": "We need to ensure peg stability before aggressive growth",
        "date": "2026-01-10"
      }
    ],
    "communicationStyle": "Technical, detailed analysis with data backing",
    "activityMetrics": {
      "postsAnalyzed": 45,
      "firstSeen": "2024-03-15",
      "lastSeen": "2026-01-12",
      "topTopics": ["risk parameters", "liquidations", "GHO"]
    }
  },
  "shouldDraft": true,
  "draftReason": "First comprehensive profile with stance information",
  "sourcePostIds": ["post-id-1", "post-id-2"]
}
```

## Guidelines

### Entity Type Signals:
- **SERVICE_PROVIDER**: Posts from organization accounts, references to contracts/deliverables, formal reports
- **DELEGATE**: "As a delegate...", voting rationale, "I will vote...", delegation discussions
- **KEY_USER**: Regular participation without formal role, community questions, feedback

### When to Draft vs Auto-Publish:
- **Draft** (shouldDraft: true): First profile, >10 posts, contains stance information, service providers
- **Auto-publish** (shouldDraft: false): Simple profiles, <5 posts, minimal stance info

### Quality Standards:
- Ground every claim in evidence from posts
- Use direct quotes for opinions/positions
- Note uncertainty ("appears to", "based on their posts")
- Include dates for timeline context
- Be balanced - include different viewpoints they've expressed

### DON'T:
- Invent background not in the data
- Make value judgments ("excellent contributor")
- Speculate about identity or affiliations
- Include information from outside the provided data

## Example Output

```json
{
  "entityType": "SERVICE_PROVIDER",
  "displayName": "Chaos Labs",
  "bio": "Risk management and simulation platform providing parameter recommendations for Aave's lending markets.",
  "profile": {
    "overview": "Chaos Labs is a primary risk service provider for Aave, responsible for monitoring market conditions and recommending parameter adjustments. Their posts typically include detailed simulations and data analysis backing their recommendations.\n\nThey coordinate closely with other risk managers (Gauntlet) and the ACI on parameter changes, often providing the technical justification for proposals.",
    "areasOfFocus": ["risk parameters", "liquidation analysis", "market simulations", "LTV recommendations"],
    "keyPositions": [
      {
        "topic": "ETH LTV increase",
        "stance": "Supportive",
        "quote": "Our simulations show the protocol can safely support 82% LTV for ETH given current market conditions",
        "date": "2026-01-08"
      },
      {
        "topic": "GHO borrow rate",
        "stance": "Cautious",
        "quote": "We recommend a gradual approach to rate reduction to monitor peg impact",
        "date": "2026-01-05"
      }
    ],
    "communicationStyle": "Highly technical with simulation data, charts, and statistical analysis. Posts are thorough but accessible.",
    "activityMetrics": {
      "postsAnalyzed": 32,
      "firstSeen": "2023-06-01",
      "lastSeen": "2026-01-12",
      "topTopics": ["risk parameters", "liquidations", "e-mode", "supply caps"]
    }
  },
  "shouldDraft": true,
  "draftReason": "Service provider profile with detailed stance information",
  "sourcePostIds": ["12345", "12346", "12389", "12401"]
}
```

Return ONLY the JSON object. No markdown code blocks, no explanations.
