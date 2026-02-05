# Library of Alexandria - Content Structure

> This defines the standard documentation structure for each protocol.
> The agent generates sections marked [AGENT], human archivists handle [MANUAL].

## Protocol Documentation Tree

```
/{protocol}/
├── overview.md                    [AGENT] - From official docs + README
│
├── /features/
│   ├── index.md                   [AGENT] - Feature overview (discovered from repo/docs)
│   ├── /core/                     [AGENT] - Core features (protocol-specific)
│   │   └── {feature}.md           # Discovered, not prescribed
│   └── /advanced/                 [AGENT] - Advanced/complex features
│       └── {feature}.md           # Discovered, not prescribed
│
├── /technical/                    [AGENT] - From repo analysis
│   ├── architecture.md            # Contract structure, relationships
│   ├── parameters.md              # Governance-controlled parameters
│   └── integrations.md            # External dependencies, oracles
│
└── /governance/
    ├── index.md                   [AGENT] - How governance works
    ├── /entities/                 [AGENT] - Key players
    │   ├── delegates/
    │   │   └── {username}.md
    │   └── service-providers/
    │       └── {org}.md
    ├── relationships.md           [AGENT] - Entity relationships, coordination patterns
    ├── legal-structure.md         [MANUAL] - Corporate filings, jurisdictions
    └── fundraising.md             [MANUAL] - ICO, token sales, investors
```

**Key principle**: Feature pages are DISCOVERED from repo/docs analysis, not prescribed.
Each protocol is unique - a lending protocol, DEX, bridge, L2 will have completely different feature sets.

## Onboarding Workflow (Discovery-First)

### Step 0: Archivist Prepares Input

Before running onboarding, create:
```
.gemini/protocols/{slug}/ONBOARDING.md
```

This file contains archivist-provided info:
- **Required URLs**: docsUrl, repoUrl, forumUrl, snapshotSpace
- **Protocol type**: Category, chains deployed
- **Key features**: What to look for (agent discovers more)
- **Governance notes**: Known structure, key players
- **Things to watch**: Contentious topics, context

Template at: `.gemini/protocols/_template/ONBOARDING.md`

### Agent Workflow

```
0. ARCHIVIST PREP
   └── Create ONBOARDING.md with URLs and notes

1. REPO_ONBOARD (repo-walker skill)
   ├── Clone repo from ONBOARDING.md repoUrl
   ├── Map contract structure
   ├── Identify features from code
   ├── Extract governance surface (admin functions, parameters)
   └── Output: technicalSummary, contract list, feature candidates

2. DOCS_CRAWL (future skill)
   ├── Start from ONBOARDING.md docsUrl
   ├── Navigate/crawl documentation pages
   ├── Extract feature descriptions
   ├── Match to repo findings
   └── Output: sourceDoc entries for each page

3. PROTOCOL_DOCS (per discovered feature)
   ├── Transform source docs
   ├── Add governance context
   ├── Cross-reference entities
   └── Output: feature pages

4. FORUM_UPDATE (ongoing)
   ├── Process governance discussions
   ├── Update entity profiles
   └── Track governance state changes
```

**Technical docs first** - Understanding the architecture informs everything else.

## Section Responsibilities

### Agent-Generated [AGENT]

| Section | Source | Skill | Order |
|---------|--------|-------|-------|
| Technical/Architecture | Repo analysis | `repo-walker` | 1st |
| Overview | Official docs, README | `protocol-docs` | 2nd |
| Features | Discovered from repo + docs | `protocol-docs` | 3rd |
| Governance process | Forum, docs | `governance-watchdog` | 4th |
| Entity profiles | Forum activity | `entity-profiles` | Ongoing |
| Relationships | Forum patterns | `governance-watchdog` | Ongoing |

### Human-Generated [MANUAL]

| Section | Source | Why Manual |
|---------|--------|------------|
| Legal Structure | Corporate filings, registries | Requires investigative research |
| Fundraising | Token sale records, investor announcements | Requires historical research |

## Quality Standards

### Agent Content
- Evidence-based (quotes, citations)
- Updated via forum monitoring
- Cross-referenced with entity profiles
- Flagged uncertainties

### Manual Content (Archivist Standards)
- Primary sources (filings, announcements)
- Date-stamped information
- "Archivist's Note" for gaps/uncertainties
- Transaction links where available

## Example: Legal Structure Page

From Aave (manual):
- Corporate registry lookups (UK Companies House, Cayman)
- Ownership chain reconstruction
- Capital injection tracking
- Director/officer identification

## Example: Entity Profile Page

From agent (forum-derived):
- Activity metrics (post count, topics)
- Areas of focus
- Key positions with quotes
- Communication style
- Relationships with other entities

---

*This structure ensures comprehensive protocol coverage while keeping agent work focused on what it does well (forum analysis) and human work on what requires investigation.*

