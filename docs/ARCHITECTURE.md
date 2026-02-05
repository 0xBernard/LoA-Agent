# Loa Agent Architecture

## Overview

The Loa Agent is an autonomous documentation agent that maintains protocol documentation for the Library of Alexandria. It synthesizes information from multiple sources (official docs, GitHub repos, forum discussions) into cohesive wiki pages.

## Core Philosophy

### 1. Code Over Chat (Cloudflare's "Code Mode")

**Source**: [Cloudflare Blog - Code Mode](https://blog.cloudflare.com/code-mode/)

**Problem**: LLMs are trained on tool-calling with synthetic examples, but have seen millions of real TypeScript codebases.

**Solution**: Instead of exposing tools directly to the LLM, we:
1. Convert tools into a TypeScript API (`DbTool`, `EntityTool`, `OutputTool`, `RepoTool`)
2. Ask the LLM to write code that calls that API
3. Execute the generated code in a sandbox

**Result**: Better accuracy, ability to handle more complex operations, and natural chaining of multiple calls without round-trips through the LLM.

```
Traditional MCP:  LLM → Tool Call → Result → LLM → Tool Call → Result → ...
Code Mode:        LLM → Generate Code → Execute All At Once → Result
```

### 2. Agent Skills (Anthropic Pattern)

**Source**: [Anthropic - Equipping Agents with Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

**Concept**: Skills are markdown files that serve as "procedural memory" - they tell the agent HOW to perform specific tasks.

**Structure**:
```
.gemini/skills/{skill-name}/SKILL.md
├── Available Tools (API signatures)
├── Workflow (step-by-step procedure)
├── Guidelines (do's and don'ts)
└── Example Code (working reference)
```

**Benefits**:
- Consistent behavior across runs
- Easy to iterate and improve procedures
- Debuggable (you can read what the agent was told to do)

### 3. Ralph Loop (ghuntley.com/ralph)

**Source**: [Ralph Architecture](https://ghuntley.com/ralph/)

**Pattern**: Read → Generate → Execute → Retry

```
┌─────────────────────────────────────────┐
│              Ralph Loop                  │
├─────────────────────────────────────────┤
│  1. Read task from queue                │
│  2. Load skill + protocol context       │
│  3. Call LLM to generate code           │
│  4. Validate code (safety checks)       │
│  5. Execute in sandbox                  │
│  6. On error: retry with error context  │
│  7. Log execution for debugging         │
└─────────────────────────────────────────┘
```

### 4. Recursive Language Model Scaffold (Experimental)

**Source**: [Recursive Language Models](https://arxiv.org/html/2512.24601v1)

**Concept**: Treat long prompts as part of the environment. The model does not receive the full
prompt in-context. Instead, it selects tool actions to inspect sections/chunks, and can recursively
spawn subtasks over subsets of the prompt.

**Implementation**:
- File-backed prompt store with chunk + section indexes.
- Tool action protocol (`list_sections`, `read_section`, `search`, `recurse`, `final`).
- Recursive runner that calls Gemini CLI step-by-step.

**Usage**:
```bash
npm run agent:rlm -- --file=./input.txt --task="Summarize the key changes"
```

**Agent Integration**:
- Enabled for forum-heavy tasks when context size or post count exceeds thresholds.
- Converts posts and protocol docs into prompt sections so the model can search/read recursively.
- Produces the same JSON output schema as the standard skills, then validates and persists.
- Supports on-demand DB context queries for forum updates (search posts, load by author, load by cursor).

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                             │
│  (You populate these manually or via existing sync scripts)     │
├─────────────────────────────────────────────────────────────────┤
│  Discourse Forum  │  GitHub Repos  │  Official Docs (scraped)   │
│       ↓                  ↓                    ↓                 │
│  forum_posts      │  (workspace)   │  protocol_source_docs      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LOA AGENT (This Project)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │
│  │  Task Queue │────▶│ Ralph Loop  │────▶│   Sandbox   │       │
│  │ (agent_tasks)     │  (agent.ts) │     │             │       │
│  └─────────────┘     └──────┬──────┘     │  DbTool     │       │
│                             │            │  EntityTool │       │
│                             ▼            │  OutputTool │       │
│                      ┌─────────────┐     │  RepoTool   │       │
│                      │   Gemini    │     └─────────────┘       │
│                      │   CLI       │            │               │
│                      └─────────────┘            │               │
│                             │                   │               │
│                             ▼                   ▼               │
│                      ┌─────────────────────────────────┐       │
│                      │  Skills + Protocol Context      │       │
│                      │  .gemini/skills/*/SKILL.md      │       │
│                      │  .gemini/protocols/*/CONTEXT.md │       │
│                      └─────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      OUTPUT PIPELINE                            │
├─────────────────────────────────────────────────────────────────┤
│  agent_drafts (DB)  ──▶  Review/Approve  ──▶  Export to MD     │
│                                                    │            │
│                                                    ▼            │
│                                              Spaces/Git         │
│                                                    │            │
│                                                    ▼            │
│                                         Existing Sync Script    │
│                                                    │            │
│                                                    ▼            │
│                                               Frontend          │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Separate VPS Deployment

**Decision**: Agent runs on its own VPS, not in the backend.

**Reasoning**:
- Isolation: Agent can be restarted/updated without affecting the main site
- Security: Agent has write access to agent.* tables only
- Resources: LLM calls and code execution don't impact API latency
- Scaling: Can run multiple agents for different protocols if needed

**Implementation**: Same database accessed via private VLAN, separate Prisma client.

### 2. Draft-First Output

**Decision**: All generated content goes to a draft table, not directly to production.

**Reasoning**:
- Quality control: Human review before publishing
- Rollback: Easy to reject bad generations
- Auditability: Track what the agent generated and when
- Safety: Prevents hallucinated content from going live

**Workflow**:
```
Agent generates → AgentDraft (PENDING) → You approve → Export to MD → Sync to production
```

### 3. Hybrid Forum Delay

**Decision**: Posts must be (a) at least N days old AND (b) have no new replies for M days.

**Reasoning**:
- Discussions evolve: Early processing might miss important context
- Quarterly reports vs proposals: Some posts get lots of discussion, others don't
- Configurable per-protocol: Different communities have different rhythms

**Configuration** (per protocol):
```
forumDelayDays: 7   # Minimum age before processing
forumQuietDays: 2   # Days without new replies
```

### 4. Token-Efficient Protocol Context

**Decision**: Per-protocol context files (~2-3K tokens) loaded with every skill.

**Reasoning**:
- Context is expensive: Loading all entity data would blow token limits
- Essential knowledge: Key delegates, terminology, governance state
- DB for details: Agent can query specific entities when needed

**Structure**:
```
.gemini/protocols/aave/CONTEXT.md
├── Protocol Overview (what it does)
├── Key Entities (service providers, delegates)
├── Governance Structure (how decisions are made)
├── Terminology (AIP, ARFC, etc.)
└── Current State (updated by agent)
```

### 5. Manual Onboarding, Automatic Updates

**Decision**: Adding a new protocol requires manual trigger; updates are automatic.

**Reasoning**:
- Data quality: You need to supply source docs before agent can work
- Intentionality: Don't want agent randomly picking up protocols
- Ongoing maintenance: Once onboarded, agent handles routine updates

**Workflow**:
```bash
# One-time setup
npm run agent:onboard -- --protocol=aave

# Automatic from here
npm run agent:daemon  # Runs every 30 min
```

### 6. Entity Auto-Publish with Draft for Major Updates

**Decision**: Basic entity profiles auto-publish; significant changes go to draft.

**Reasoning**:
- Reduce friction: Simple profiles (name, activity count) are low-risk
- Catch issues: Controversial stances or major profile changes need review
- Progressive enhancement: Start basic, improve over time

**Auto-publish criteria**:
- New entity with minimal history
- Routine activity updates
- No controversial content detected

### 7. No MCP Dependency

**Decision**: Direct Prisma wrapper instead of MCP → mcporter pipeline.

**Reasoning**:
- Simpler: One less abstraction layer
- You already have Prisma: Database access is well-understood
- Performance: Direct DB calls vs protocol overhead
- Flexibility: Can add custom queries easily

**Implementation**: Tools in `src/tools/*.ts` wrap Prisma directly.

## Database Schema

### Agent-Owned Tables (Read/Write)

| Table | Purpose |
|-------|---------|
| `protocol_agent_context` | Agent's memory per protocol |
| `entity_observations` | Notes about delegates/users |
| `protocol_source_docs` | Ingested official docs |
| `protocol_entities` | Delegate/SP profiles |
| `agent_drafts` | Generated pages pending review |
| `agent_tasks` | Work queue |
| `agent_execution_logs` | Debugging/audit trail |

### Backend-Owned Tables (Read-Only)

| Table | Purpose |
|-------|---------|
| `protocol` | Protocol metadata |
| `governance_spaces` | Snapshot spaces |
| `discourse_topics` | Forum threads |
| `forum_posts` | Individual posts |
| `token_holders` | Delegate addresses |
| `delegate_aliases` | ENS, forum usernames |

## File Structure

```
loa-agent/
├── .gemini/
│   ├── protocols/
│   │   └── aave/
│   │       └── CONTEXT.md      # Aave-specific knowledge
│   └── skills/
│       ├── governance/
│       │   └── SKILL.md        # Forum processing
│       ├── onboarding/
│       │   └── SKILL.md        # Repo analysis
│       ├── entity-profiles/
│       │   └── SKILL.md        # Delegate/SP profiles
│       └── protocol-docs/
│           └── SKILL.md        # Doc synthesis
├── src/
│   ├── lib/
│   │   ├── config.ts           # Environment config
│   │   ├── gemini.ts           # LLM integration
│   │   ├── logger.ts           # Logging
│   │   ├── prisma.ts           # DB client
│   │   └── sandbox.ts          # Code execution
│   ├── tools/
│   │   ├── db.ts               # Database operations
│   │   ├── entities.ts         # Entity management
│   │   ├── output.ts           # Drafts & export
│   │   └── repo.ts             # Git/filesystem
│   ├── agent.ts                # Ralph loop
│   └── index.ts                # CLI entry point
├── prisma/
│   └── schema.prisma           # DB schema (mirrors backend)
├── docs/
│   └── ARCHITECTURE.md         # This file
└── README.md                   # Quick start guide
```

## Security Considerations

### Sandbox Restrictions

The sandbox environment:
- Has NO network access (fetch/connect blocked)
- Has NO filesystem access outside workspace
- Has NO process spawning (child_process blocked)
- Has NO eval/Function constructor
- Has access ONLY to provided tools

### Code Validation

Before execution, generated code is checked for:
- `require()` calls
- `import` statements
- `process.*` access
- `eval()` / `Function()`
- Prototype pollution patterns
- Maximum length (50KB)

### Database Isolation

- Agent schema (`agent.*`) is read/write
- Governance schema is read-only (enforced by tools)
- No raw SQL mutations allowed (SELECT only via `rawQuery`)

## Adding a New Protocol

1. **Supply Data**:
   - Sync forum posts to `discourse_topics` + `forum_posts`
   - (Optional) Clone repo to workspace
   - (Optional) Scrape official docs to `protocol_source_docs`

2. **Create Context File**:
   ```bash
   .gemini/protocols/{slug}/CONTEXT.md
   ```
   Copy from `aave/CONTEXT.md` and customize.

3. **Onboard**:
   ```bash
   npm run agent:onboard -- --protocol={slug}
   ```

4. **Review Initial Output**:
   ```bash
   npm run agent:drafts -- --protocol={slug}
   ```

5. **Enable Daemon**:
   The daemon will automatically process the protocol going forward.

## Troubleshooting

### Check Execution Logs
```sql
SELECT * FROM agent.agent_execution_logs 
ORDER BY created_at DESC 
LIMIT 20;
```

### Check Task Queue
```sql
SELECT * FROM agent.agent_tasks 
WHERE status IN ('PENDING', 'RUNNING')
ORDER BY priority DESC;
```

### Reset a Failed Task
```sql
UPDATE agent.agent_tasks 
SET status = 'PENDING', attempts = 0, last_error = NULL 
WHERE id = 'task-id';
```

### Force Reprocess Posts
```sql
UPDATE agent.protocol_agent_context 
SET last_processed_post_id = 0 
WHERE protocol_id = 'protocol-id';
```

