# Design Decisions Log

This document captures the reasoning behind key decisions made during the design of the Loa Agent.

---

## Decision 1: Code Mode vs Traditional Tool Calling

**Date**: January 2026

**Context**: Need to give an LLM agent access to database operations, file system, and external APIs.

**Options Considered**:
1. **MCP (Model Context Protocol)** - Standard tool-calling interface
2. **Function Calling** - Native LLM tool use
3. **Code Mode** - LLM writes TypeScript that calls our APIs

**Decision**: Code Mode

**Reasoning**:
- Cloudflare's research shows LLMs perform better writing code than making tool calls
- LLMs have trained on millions of real TypeScript codebases vs synthetic tool-call examples
- Code allows natural chaining: `const posts = await getPosts(); for (const p of posts) { ... }`
- Reduces round-trips: One code generation can do what would take 10+ tool calls

**Trade-offs**:
- (+) Better at complex, multi-step operations
- (+) More natural for the LLM
- (-) Requires sandbox for safe execution
- (-) Generated code can have bugs

**Reference**: https://blog.cloudflare.com/code-mode/

---

## Decision 2: Separate VPS Deployment

**Date**: January 2026

**Context**: Agent needs to access the same database as the backend but performs different workloads.

**Options Considered**:
1. **Same server** - Run agent as a service alongside the API
2. **Separate VPS** - Dedicated machine for the agent
3. **Serverless** - Cloud functions triggered by events

**Decision**: Separate VPS on private VLAN

**Reasoning**:
- LLM calls are slow (seconds) - would block API requests if shared
- Code execution is CPU-intensive - could impact API latency
- Agent can be restarted/deployed independently
- Database access via private VLAN is secure and fast
- Easier to scale: can add more agent instances if needed

**Trade-offs**:
- (+) Clean separation of concerns
- (+) Independent scaling
- (+) No impact on API performance
- (-) Additional infrastructure to manage
- (-) Schema must be kept in sync

---

## Decision 3: Draft-First Content Pipeline

**Date**: January 2026

**Context**: Agent generates wiki pages that will be shown to users.

**Options Considered**:
1. **Direct publish** - Agent writes directly to production tables
2. **Draft + review** - Agent creates drafts, human approves
3. **PR workflow** - Agent creates Git PRs for review

**Decision**: Draft + review (with export to existing MD sync)

**Reasoning**:
- LLMs can hallucinate - need human verification
- Easy rollback: reject draft, nothing changes
- Audit trail: can see what agent generated
- Integrates with existing workflow: MD files → Spaces → sync script

**Trade-offs**:
- (+) Safety net for bad generations
- (+) Maintains quality control
- (+) Works with existing infrastructure
- (-) Adds friction to publishing
- (-) Human bottleneck for approval

---

## Decision 4: Hybrid Forum Delay

**Date**: January 2026

**Context**: Forum posts need to be processed, but timing matters for capturing full discussions.

**Options Considered**:
1. **Fixed delay** - Wait N days after post creation
2. **Activity-based** - Wait until no new replies
3. **Manual tagging** - Mark posts as "ready to process"
4. **Hybrid** - Fixed minimum + activity check

**Decision**: Hybrid (minimum delay + quiet period)

**Reasoning**:
- Some posts (proposals) generate days of discussion
- Other posts (quarterly reports) get no replies
- Fixed delay alone might miss ongoing discussions
- Activity-only might process too soon on low-engagement posts
- Hybrid ensures both minimum age AND settled discussion

**Configuration**:
```
forumDelayDays: 7   # Post must be at least 7 days old
forumQuietDays: 2   # AND have no new replies for 2 days
```

**Trade-offs**:
- (+) Catches full discussions
- (+) Doesn't wait forever on quiet posts
- (-) Adds latency to processing
- (-) More complex logic

---

## Decision 5: Per-Protocol Context Files

**Date**: January 2026

**Context**: Agent needs protocol-specific knowledge (delegates, terminology, governance state).

**Options Considered**:
1. **All in DB** - Store everything in database tables
2. **All in files** - Markdown files loaded with prompts
3. **Hybrid** - Summary files + DB for details

**Decision**: Hybrid (context files + DB queries)

**Reasoning**:
- Token efficiency: Loading all entities would exceed limits
- Essential context: Key delegates, terminology always needed
- On-demand details: Agent can query specific entities when needed
- Human-editable: Context files can be manually improved

**Structure**:
```
CONTEXT.md (~2-3K tokens)
├── Key entities (names only)
├── Terminology glossary
├── Governance overview
└── Current state summary

DB (queried as needed)
├── Full entity profiles
├── Historical observations
└── Complete forum posts
```

**Trade-offs**:
- (+) Token efficient
- (+) Fast (no DB query for basic context)
- (+) Human-editable
- (-) Context files must be maintained
- (-) Could get out of sync with DB

---

## Decision 6: Manual Onboarding + Automatic Updates

**Date**: January 2026

**Context**: Agent will handle multiple protocols over time.

**Options Considered**:
1. **Fully automatic** - Agent discovers and onboards new protocols
2. **Fully manual** - Human triggers every run
3. **Manual onboard, auto update** - Human initiates, agent maintains

**Decision**: Manual onboard, automatic updates

**Reasoning**:
- Data must be supplied first (forum sync, source docs)
- Don't want agent randomly picking up protocols
- Once data is there, updates are routine
- Human stays in control of scope

**Workflow**:
```
Manual: Supply data → Trigger onboard → Review initial output
Automatic: Daemon runs → Processes new posts → Updates entities
```

**Trade-offs**:
- (+) Human controls which protocols are active
- (+) No surprise agent activity
- (+) Routine work is automated
- (-) Adding protocols requires manual steps
- (-) Could forget to onboard a protocol

---

## Decision 7: Entity Auto-Publish for Basic Profiles

**Date**: January 2026

**Context**: Agent discovers and profiles entities (delegates, service providers).

**Options Considered**:
1. **All drafts** - Every entity change goes to review
2. **All auto-publish** - Trust the agent completely
3. **Tiered** - Auto-publish basic, draft significant changes

**Decision**: Tiered (basic auto-publish, major changes drafted)

**Reasoning**:
- Basic profiles are low-risk (name, post count)
- Controversial content needs review (stances, opinions)
- Reduces review burden while maintaining safety
- Can adjust thresholds as confidence grows

**Auto-publish criteria**:
- New entity with < 10 posts
- Activity count updates
- No stance/opinion content

**Draft criteria**:
- First full profile generation
- Stance or opinion detection
- High-profile entity updates

**Trade-offs**:
- (+) Reduced review burden
- (+) Fast profile creation
- (-) Risk of auto-publishing incorrect info
- (-) Classification might miss edge cases

---

## Decision 8: No MCP/mcporter Dependency

**Date**: January 2026

**Context**: MCP is standard for AI tool access; mcporter converts MCP to TypeScript.

**Options Considered**:
1. **Use MCP** - Standard protocol, works with many clients
2. **Use mcporter** - Convert MCP to TypeScript APIs
3. **Direct Prisma** - Write tools directly against database

**Decision**: Direct Prisma wrappers

**Reasoning**:
- Already using Prisma in the backend
- No additional protocol overhead
- Full control over API design
- Can optimize queries for agent use cases
- Simpler debugging (no protocol layer)

**Trade-offs**:
- (+) Simpler architecture
- (+) Better performance
- (+) Full control
- (-) Not portable to other MCP clients
- (-) Must maintain tool implementations

---

## Decision 9: Gemini CLI with API Fallback

**Date**: January 2026

**Context**: Need to call an LLM for code generation.

**Options Considered**:
1. **API only** - Direct HTTP calls to LLM API
2. **CLI only** - Use gemini CLI tool
3. **CLI with fallback** - Try CLI, fall back to API

**Decision**: CLI with API fallback

**Reasoning**:
- CLI handles auth and rate limiting
- Leverages existing quotas/billing
- API fallback for environments without CLI
- Can switch models via config

**Implementation**:
```typescript
let response = await callGeminiCLI(prompt);
if (!response.success && process.env.GEMINI_API_KEY) {
  response = await callGeminiAPI(prompt);
}
```

**Trade-offs**:
- (+) Flexible deployment options
- (+) Uses existing auth setup
- (-) CLI must be installed and authenticated
- (-) Two code paths to maintain

