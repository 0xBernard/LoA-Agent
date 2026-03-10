# Loa Agent

Autonomous Documentation Agent for the Library of Alexandria.

## Overview

Loa Agent monitors crypto governance forums and repositories to maintain up-to-date protocol documentation. It uses **Gemini CLI** in headless mode to analyze forum posts, extract entity profiles, and generate documentation drafts.

### Architecture

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
│        │         │  │ DbTool  │  │ Entities│  │ Output│ │    │
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

### Key Features

- **Gemini CLI Integration** - Uses native headless mode with JSON output
- **Skill-Based Architecture** - Skills in `.gemini/skills/` define task behavior
- **Validation Layer** - Schema + quality checks before persisting
- **Protocol-Specific Learnings** - Context files per protocol
- **Draft Review System** - Major changes go through human review
- **Discord Webhooks** - Stream logs and alerts to Discord

## Quick Start

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- PostgreSQL (same database as backend)
- Gemini authentication configured (recommended OAuth via `gemini auth login` or `gcloud auth application-default login`; API key env also supported)

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
AGENT_DB_WRITE_GUARD="on"        # Block writes outside agent schema
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

# Onboard from an uploaded file (saves ONBOARDING.md + creates tasks)
npm run agent:onboard-file -- --protocol=aave --file=./aave-test/aave-onboarding.md

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
- **[Security Notes](SECURITY.md)** - `--yolo` runtime safety guidance

## References

- [Ralph Architecture](https://ghuntley.com/ralph/) - Main loop pattern
- [Gemini CLI Docs](https://geminicli.com/docs/) - CLI usage
- [Anthropic: Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) - Skills pattern
