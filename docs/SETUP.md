# Loa Agent Setup Guide

## Prerequisites

- **Node.js 20+**
- **PostgreSQL** (same database as backend, accessible via private VLAN)
- **Gemini CLI** authenticated (`gemini auth login`) OR `GEMINI_API_KEY`

## Installation

### 1. Clone and Install

```bash
cd loa-agent
npm install
```

### 2. Configure Environment

```bash
cp env.example .env
```

Edit `.env`:

```bash
# Database (connect to same DB as backend via private VLAN)
DATABASE_URL="postgresql://user:password@db-internal:5432/library_of_alexandria"

# Gemini (pick one)
# Option A: CLI (run `gemini auth login` first)
GEMINI_MODEL="gemini-2.0-flash"

# Option B: API key
GEMINI_API_KEY="your-api-key"

# Agent settings
AGENT_WORKSPACE="./workspace"
AGENT_LOG_LEVEL="info"
AGENT_CRON="*/30 * * * *"

# Limits
MAX_POSTS_PER_RUN=50
MAX_RETRIES=3
CODE_EXECUTION_TIMEOUT_MS=30000

# Discord alerts and log streaming (optional)
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
DISCORD_NOTIFY_ON="task_failed,task_error,draft_created"
DISCORD_LOG_LEVEL="info"
```

### 3. Database Setup

The agent schema is defined in the main backend's Prisma. Make sure it's been pushed:

```bash
# In the backend project
npx prisma db push
```

Or create the schema manually:

```sql
CREATE SCHEMA IF NOT EXISTS agent;
```

Then generate the Prisma client for the agent:

```bash
# In loa-agent
npm run db:generate
```

### Database Role (Least Privilege)

If you want the agent to read everything but only write to `agent.*` tables, create a dedicated DB role:

```sql
-- Create a dedicated role for the agent
CREATE ROLE loa_agent LOGIN PASSWORD 'replace-with-strong-password';

-- Allow schema usage
GRANT USAGE ON SCHEMA public, governance, tokens, agent TO loa_agent;

-- Read-only on backend-owned schemas
GRANT SELECT ON ALL TABLES IN SCHEMA public, governance, tokens TO loa_agent;

-- Read/write on agent-owned schema
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agent TO loa_agent;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agent TO loa_agent;

-- Ensure future tables inherit privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA public, governance, tokens
GRANT SELECT ON TABLES TO loa_agent;
ALTER DEFAULT PRIVILEGES IN SCHEMA agent
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO loa_agent;
ALTER DEFAULT PRIVILEGES IN SCHEMA agent
GRANT USAGE, SELECT ON SEQUENCES TO loa_agent;
```

Then set `DATABASE_URL` to use the `loa_agent` user. The app also enforces a write guard by default:

```bash
AGENT_DB_WRITE_GUARD="on"
```

### 4. Verify Connection

```bash
npm run db:studio
```

This opens Prisma Studio - verify you can see the `agent` schema tables.

## Gemini CLI Setup

If using the CLI approach (recommended):

```bash
# Install globally
npm install -g @google/generative-ai-cli

# Authenticate
gemini auth login

# Test
echo "Hello" | gemini prompt
```

## First Run

### 1. Onboard a Protocol

Before the agent can work, you need data in the database:
- Forum posts synced to `discourse_topics` and `forum_posts`
- (Optional) Source docs in `protocol_source_docs`

Then onboard:

```bash
npm run agent:onboard -- --protocol=aave
```

Or if you have an onboarding file (e.g., from Discord/Telegram upload):

```bash
npm run agent:onboard-file -- --protocol=aave --file=./aave-test/aave-onboarding.md
```

This creates:
- `ProtocolAgentContext` entry with `isOnboarded=true`
- Initial tasks: `ENTITY_PROFILE`, `PROTOCOL_DOCS`, `FORUM_UPDATE`

### 2. Process Tasks

```bash
npm run agent:run
```

Watch the logs to see task processing.

### 3. Check Output

```bash
# List drafts
npm run agent:drafts -- --protocol=aave

# Check status
npm run agent:status -- --protocol=aave
```

### 4. Export Approved Drafts

After reviewing and approving drafts in the database:

```bash
npm run agent:export -- --protocol=aave --output=./drafts
```

## Daemon Mode

For production, run as a daemon:

```bash
npm run agent:daemon
```

Or with pm2:

```bash
pm2 start npm --name "loa-agent" -- run agent:daemon
pm2 save
```

### Systemd Service

Create `/etc/systemd/system/loa-agent.service`:

```ini
[Unit]
Description=Loa Documentation Agent
After=network.target

[Service]
Type=simple
User=loa
WorkingDirectory=/opt/loa-agent
ExecStart=/usr/bin/npm run agent:daemon
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl enable loa-agent
sudo systemctl start loa-agent
sudo systemctl status loa-agent
```


## Adding More Protocols

1. **Sync forum data** to the database (via backend's discourse sync)

2. **Create context file**:
   ```bash
   mkdir -p .gemini/protocols/{slug}
   cp .gemini/protocols/aave/CONTEXT.md .gemini/protocols/{slug}/
   # Edit with protocol-specific info
   ```

3. **Onboard**:
   ```bash
   npm run agent:onboard -- --protocol={slug}
   ```

4. **Verify**:
   ```bash
   npm run agent:status -- --protocol={slug}
   ```

## Monitoring

### Check Logs

```bash
# If using pm2
pm2 logs loa-agent

# If using systemd
journalctl -u loa-agent -f
```

### Database Queries

```sql
-- Recent executions
SELECT skill_name, success, execution_ms, created_at 
FROM agent.agent_execution_logs 
ORDER BY created_at DESC LIMIT 20;

-- Pending tasks
SELECT type, protocol_id, status, attempts, created_at 
FROM agent.agent_tasks 
WHERE status = 'PENDING';

-- Draft stats
SELECT status, COUNT(*) 
FROM agent.agent_drafts 
GROUP BY status;
```

## Troubleshooting

### "Protocol not found"

Make sure the protocol exists in the `protocol` table with a `governance_space` relation:

```sql
SELECT p.id, p.slug, gs.id as space_id 
FROM public.protocol p
LEFT JOIN governance.governance_spaces gs ON gs.protocol_id = p.id
WHERE p.slug = 'aave';
```

### "No pending tasks"

The daemon only processes onboarded protocols. Check:

```sql
SELECT protocol_id, is_onboarded 
FROM agent.protocol_agent_context;
```

### Code execution fails

Check the generated code in the execution logs:

```sql
SELECT generated_code, error_message 
FROM agent.agent_execution_logs 
WHERE success = false 
ORDER BY created_at DESC LIMIT 1;
```

Common issues:
- TypeScript syntax not stripped properly
- Undefined tool called
- Timeout exceeded

### Gemini CLI errors

Test the CLI directly:

```bash
echo "Write hello world in TypeScript" | gemini prompt
```

If it fails, re-authenticate:

```bash
gemini auth logout
gemini auth login
```

## Discord Bot (Optional)

Use Discord for onboarding with channel-based routing:

- Map a channel to a protocol slug via `DISCORD_ONBOARD_CHANNELS`
- Post `!onboard <content>` in that channel (or upload a `.md` file)

Example `.env`:
```
DISCORD_BOT_TOKEN="..."
DISCORD_ONBOARD_PREFIX="!onboard"
DISCORD_ALLOWED_GUILD_IDS="123456789012345678"
DISCORD_ALLOWED_CHANNEL_IDS="123456789012345678,987654321098765432"
DISCORD_ONBOARD_CHANNELS="{\"123456789012345678\":{\"slug\":\"aave\"}}"
```

Start the bot:
```
npm run agent:discord
```

The bot writes `.gemini/protocols/{slug}/ONBOARDING.md` and runs `tool:onboard`.

## QMD Memory (Optional)

QMD is a local search index for the PARA memory files. Install it and point the agent at it
to enable `qmd_*` actions in the recursive tool scaffold.

Quick start:
```
bun install -g github:tobi/qmd
qmd collection add /path/to/life --name life --mask "**/*.{md,json}"
qmd collection add /path/to/memory --name memory --mask "**/*.md"
qmd update
```

Then configure:
```
QMD_BIN="qmd"
QMD_INDEX=""
```

Reference: https://github.com/tobi/qmd

## PARA Memory Cache (Optional)

This agent can maintain a PARA-style memory cache on disk. It is used to load
protocol summaries into the LLM context and to power QMD search.

Default path:
```
AGENT_MEMORY_ROOT="/var/lib/loa-agent/memory"
```

Structure:
```
memory/
└── projects/
    └── aave/
        ├── summary.md
        └── items.json
```

The agent refreshes `summary.md` and `items.json` after successful tasks.