# Loa Agent

**The Autonomous Archivist for the Library of Alexandria.**

## Mission: The Comprehensive Archive

Loa Agent is not just a documentation generator; it is a **living, evolving archivist**. Its goal is to build the single source of truth for crypto protocols—a "One Stop Shop" that bridges the gap between raw on-chain data, governance chatter, and technical source code.

The Agent operates on two pillars:

### 1. Protocol & Ecosystem (The Historian)
*   **Goal:** Capture the "human" side of the protocol.
*   **Scope:**
    *   **Governance History:** Tracking key decisions, proposals, and the "why" behind changes.
    *   **Service Providers:** Detailed profiles of active organizations (e.g., Chaos Labs, Gauntlet), indexing their reports, financial relationships, and voting history.
    *   **Cultural Context:** Synthesizing forum debates to explain the political landscape.
*   **Sources:** Discourse Forums, Snapshot, Governance Contracts, Financial Reports.

### 2. Technical Deep-Dive (The Auditor)
*   **Goal:** Create developer-grade references from the metal up.
*   **Scope:**
    *   **Smart Contract Analysis:** Line-by-line breakdown of core contracts (State variables, logic flows, risks).
    *   **Architecture Mapping:** Visualizing how "Hubs", "Spokes", and "Portals" interact.
    *   **Developer Guides:** Practical "How-To" guides derived from actual test files and SDKs.
*   **Sources:** GitHub Repositories (Cloned & Analyzed), Whitepapers, Audits.

## Architecture

Based on the **"Ralph" architecture** from [ghuntley.com/ralph](https://ghuntley.com/ralph/):

```
┌──────────────────────────────────────────────────────────────┐
│                         Loa Agent                             │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│   ┌──────────┐    ┌──────────┐    ┌──────────────────┐      │
│   │  Task    │───▶│  Skill   │───▶│   Gemini CLI     │      │
│   │  Queue   │    │  Loader  │    │   (headless)     │      │
│   └──────────┘    └──────────┘    └────────┬─────────┘      │
│        ▲                                    │                 │
│        │                                    ▼                 │
│        │                            ┌──────────────┐         │
│        │                            │ JSON Response │         │
│        │                            └───────┬──────┘         │
│        │                                    │                 │
│        │         ┌──────────────────────────┴───────────┐    │
│        │         │           Validate & Persist          │    │
│        │         │  ┌─────────┐  ┌─────────┐  ┌───────┐ │    │
│        │         │  │ Archive │  │ Contracts│ │Reports│ │    │
│        │         │  └────┬────┘  └────┬────┘  └───┬───┘ │    │
│        │         └───────┼────────────┼──────────┼──────┘    │
│        │                 │            │          │            │
│        │                 ▼            ▼          ▼            │
│   ┌────┴─────────────────────────────────────────────────┐   │
│   │                      PostgreSQL                       │   │
│   │            (Same DB as backend, via VLAN)            │   │
│   └──────────────────────────────────────────────────────┘   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

## Workflows

### A. Repository Analysis (Codebase Investigator)
1.  **Clone:** The agent clones target repositories (e.g., `aave-v3-origin`) to a secure workspace.
2.  **Map:** It generates a file tree and dependency graph.
3.  **Analyze:** It reads `.sol` / `.ts` files to extract logic, events, and storage layouts.
4.  **Synthesize:** It generates `SmartContract` records and technical documentation pages.

### B. Forum Archival (Governance Watcher)
1.  **Index:** The agent scans Discourse topics to identify key discussions.
2.  **Filter:** It identifies "High Value" posts (e.g., lengthy analysis, official reports).
3.  **Extract:** It parses these posts to find links to PDFs, Spreadsheets, or external dashboards.
4.  **Profile:** It updates `ProtocolEntity` profiles with new findings (e.g., "Chaos Labs published a new risk review").

## Quick Start

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- PostgreSQL (same database as backend)
- Gemini CLI authenticated: `gemini auth login`

### Installation

```bash
git clone <repo>
cd loa-agent
npm install
npm run db:generate
```

### Configuration

```bash
cp env.example .env
# Edit .env with your DATABASE_URL and other settings
```

Key settings in `.env`:
```bash
DATABASE_URL="postgresql://..."  # Same DB as backend
GEMINI_MODEL="gemini-3.0-pro"    # Model to use
AGENT_CRON="*/30 * * * *"        # Run every 30 minutes
FORUM_BATCH_SIZE=250             # Posts per Gemini call
RLM_ENABLED=true                 # Use recursive scaffold for large contexts
RLM_CONTEXT_BYTES_THRESHOLD=200000  # Trigger RLM by context size
RLM_MIN_POSTS=80                 # Trigger RLM by post count
DISCORD_WEBHOOK_URL=""           # Optional Discord webhook for logs + alerts
DISCORD_NOTIFY_ON="task_failed,task_error,draft_created"
DISCORD_LOG_LEVEL="info"
```

Discord webhooks:
- `task_failed` (needs assistance), `task_error` (retryable errors), `draft_created` (docs to review)
- `DISCORD_LOG_LEVEL` streams logs at or above the configured level

### Run

```bash
# Single run - process pending tasks
npm run agent:run

# Daemon mode - run on schedule
npm run agent:daemon

```

## Deployment (PM2)

The agent runs on a dedicated VPS (2GB RAM / 1 CPU recommended).

```bash
# Install
git clone <repo>
cd loa-agent
npm ci
npm run build
npm run db:generate

# Configure
cp env.example .env
nano .env  # Edit settings

# Authenticate Gemini CLI
gemini auth login

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Auto-start on reboot

# View logs
pm2 logs

# Monitor
pm2 monit
```

### PM2 Commands

```bash
pm2 start ecosystem.config.cjs              # Start daemon
pm2 restart all                             # Restart all
pm2 stop all                                # Stop all
pm2 delete all                              # Remove from PM2
```

## CLI Commands

```bash
# Onboard a new protocol
npm run agent:onboard -- --protocol=aave

# Process pending tasks
npm run agent:run

# Run daemon (cron-based)
npm run agent:daemon

# Check protocol status
npm run agent:status -- --protocol=aave

# List drafts
npm run agent:drafts -- --protocol=aave
npm run agent:drafts -- --protocol=aave --status=PENDING

# Export approved drafts
npm run agent:export -- --protocol=aave --output=./drafts

# Run the recursive tool scaffold on a file (experimental)
npm run agent:rlm -- --file=./input.txt --task="Summarize key governance changes"
```

## Skills

Skills are markdown files in `.gemini/skills/` that define how the agent performs tasks:

| Skill | Task Type | Purpose |
|-------|-----------|---------|
| `governance/SKILL.md` | FORUM_UPDATE | Analyze forum posts, extract governance state |
| `entity-profiles/SKILL.md` | ENTITY_PROFILE | Generate delegate/service provider profiles |
| `onboarding/SKILL.md` | REPO_ONBOARD | Analyze repository architecture |
| `protocol-docs/SKILL.md` | PROTOCOL_DOCS | Transform source docs into wiki pages |
| `recursive-tools/SKILL.md` | RLM scaffold | Recursive tool controller for long prompts |

Each skill outputs structured JSON that the agent validates and persists.

## Protocol Files

Per-protocol knowledge lives in `.gemini/protocols/{slug}/`:

```
.gemini/protocols/aave/
├── CONTEXT.md      # Static knowledge (governance structure, key entities)
├── LEARNINGS.md    # Agent discoveries (patterns, quirks)
└── ONBOARDING.md   # Archivist input for initial onboarding
```

## Development

```bash
# Dev mode with hot reload
npm run dev

# Type check
npx tsc --noEmit

# Generate Prisma client
npm run db:generate
```

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** - System design and data flow
- **[Design Decisions](docs/DECISIONS.md)** - Why we made the choices we did
- **[Setup Guide](docs/SETUP.md)** - Detailed installation guide
- **[Content Structure](/.gemini/CONTENT_STRUCTURE.md)** - Wiki page structure

## References

- [Ralph Architecture](https://ghuntley.com/ralph/) - Main loop pattern
- [Gemini CLI Docs](https://geminicli.com/docs/) - CLI usage
- [Anthropic: Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) - Skills pattern

