# Loa Agent Architecture Session - January 15, 2026

## Summary

Refactored the Loa agent to use **Gemini CLI's native capabilities** instead of custom code generation + sandbox execution.

## Key Decisions

### 1. Gemini CLI Only (No API)
- Removed `callGeminiAPI()` fallback
- Using CLI subscription (1000 calls/day)
- Model: `gemini-3-pro` (configurable)

### 2. Native Skills Integration
Gemini CLI has built-in Agent Skills support that matches our SKILL.md approach:
- Skills auto-discovered from `.gemini/skills/`
- CLI injects skill name/description into system prompt
- Model calls `activate_skill` tool when relevant
- `--yolo` flag auto-approves skill activation in headless mode

**Documentation**: https://geminicli.com/docs/cli/skills/

### 3. Structured JSON Output (Not Code Generation)
Old approach: Gemini generates TypeScript code → Execute in VM sandbox
New approach: Gemini returns structured JSON → TypeScript parses and persists

**Why**: More reliable, no code validation needed, native CLI tools handle shell/file ops

### 4. Gemini 3 Pro Strengths (from Vending-Bench 2)
- **#1 on long-term coherence benchmark** ($5,478 vs Claude Opus $4,967)
- "No signs of performance degradation" over long horizons
- 90.7% on t2-bench (agentic tool use)
- Perfect for ongoing forum monitoring over months

**Source**: https://andonlabs.com/evals/vending-bench-2

## Files Changed

### Modified
- `src/lib/gemini.ts` - Simplified to call `gemini --prompt ... --yolo --output-format json`
- `src/agent.ts` - Removed sandbox execution, now parses JSON responses and persists to DB
- `src/lib/config.ts` - Updated model default to `gemini-3-pro`, `FORUM_BATCH_SIZE=200`
- `.gemini/skills/governance/SKILL.md` - Rewritten to output JSON instead of code
- `.gemini/skills/entity-profiles/SKILL.md` - Converted to JSON output
- `.gemini/skills/onboarding/SKILL.md` - Converted to JSON output  
- `.gemini/skills/protocol-docs/SKILL.md` - Converted to JSON output
- `env.example` - Updated model name, added batch size config

### Added
- `AGENT.md` - General cross-protocol operational learnings
- `.gemini/protocols/aave/LEARNINGS.md` - Aave-specific agent learnings
- `.gemini/protocols/aave/ONBOARDING.md` - Archivist input for onboarding
- `.gemini/protocols/_template/ONBOARDING.md` - Template for new protocols
- `.gemini/CONTENT_STRUCTURE.md` - Wiki structure (agent vs manual sections)
- `src/lib/validation.ts` - Response validation & backpressure layer
- `ecosystem.config.cjs` - PM2 production config (2GB RAM tuned)
- `.nvmrc` - Node version pinning

### Removed
- `Dockerfile` - Using bare metal PM2 deployment instead (saves ~200MB RAM)
- `docker-compose.yml` - Not needed for single-purpose agent server

### Architecture Change
```
BEFORE:
  Task → Load SKILL.md → Pipe to Gemini → Generate TypeScript → Validate → VM Sandbox → Tools mutate DB

AFTER:
  Task → Build Context JSON → gemini --prompt --yolo → Parse JSON Response → TypeScript persists to DB
```

### Headless Mode Usage
```bash
# Basic call
gemini --prompt "analyze this" --output-format json --yolo

# With piped data
cat context.json | gemini --prompt "process this" --yolo --output-format json

# Specific model
gemini --prompt "query" --model gemini-3-pro --yolo
```

**Documentation**: https://geminicli.com/docs/cli/headless/

## Skill Format (Unchanged)
Our SKILL.md files are already in the correct format for Gemini CLI:
```markdown
---
name: skill-name
description: When to use this skill
---

# Instructions
...
```

Skills discovered from:
1. `.gemini/skills/` (project) - ✅ What we use
2. `~/.gemini/skills/` (user)
3. Extensions

## Governance Skill Output Format
```json
{
  "governanceSummary": "Markdown summary...",
  "entities": [
    {
      "identifier": "username",
      "activityLevel": "HIGHLY_ACTIVE",
      "observation": "Description with quotes",
      "observationType": "DELEGATE_STANCE",
      "confidence": 85
    }
  ],
  "maxProcessedPostId": 12345,
  "insights": ["Emerging topic...", "Pattern..."]
}
```

## TODO (Not Completed)
- [x] Update entity-profiles SKILL.md to JSON output format
- [x] Update protocol-docs SKILL.md to JSON output format  
- [x] Update onboarding SKILL.md to JSON output format
- [x] Add result handlers in `executeTask()` for ENTITY_PROFILE, PROTOCOL_DOCS, REPO_ONBOARD tasks
- [ ] **Add docs crawler** - Given base URL, navigate and extract official documentation
- [ ] Test with real Aave forum data
- [ ] Verify Gemini CLI headless mode works on Windows (command may need adjustment)
- [ ] Consider building MCP server for database tools (alternative to JSON parsing)

## Ralph-Inspired Improvements (Added)
- [x] Added `AGENT.md` for general cross-protocol learnings
- [x] Added `.gemini/protocols/{slug}/LEARNINGS.md` for protocol-specific learnings
- [x] Agent now loads both CONTEXT.md and LEARNINGS.md per protocol
- [x] Updated FORUM_BATCH_SIZE to 200 (staying under 500k token budget)
- [x] Added validation/backpressure layer (`src/lib/validation.ts`)
  - Zod schemas for all task response types
  - Quality checks (placeholder detection, content length, entity reference)
  - Loop-back verification prompt builder (for optional second-pass validation)
- [ ] Implement agent self-updating of LEARNINGS.md files

## Validation Layer (Backpressure)

Ralph pattern: **Validate before persisting**. The agent now validates Gemini's responses at two levels:

### 1. Schema Validation (Zod)
Each task type has a defined schema:
- `GovernanceResponseSchema` - governanceSummary, entities, maxProcessedPostId
- `EntityProfileResponseSchema` - entityType, bio, profile, shouldDraft
- `RepoAnalysisResponseSchema` - technicalSummary, contracts, governanceSurface
- `ProtocolDocsResponseSchema` - page, metadata, shouldDraft

### 2. Quality Checks
- **Placeholder detection**: Rejects `[TODO]`, `[PLACEHOLDER]` content
- **Content length**: Warns on suspiciously short summaries
- **Entity extraction**: Warns if no entities found from large post batches
- **Reference validation**: Checks profile mentions the entity being profiled

### 3. Loop-back Verification (Optional)
For critical tasks, can run a second Gemini call to verify coherence:
```typescript
import { buildVerificationPrompt } from './lib/validation.js';
const prompt = buildVerificationPrompt(taskType, originalContext, response);
// Call Gemini with verification prompt, check "verified" boolean
```

## Config Changes
```env
GEMINI_MODEL="gemini-3-pro"
FORUM_BATCH_SIZE=200  # Posts per Gemini call (target ~500k tokens)
```

## Removed/Deprecated
- `src/lib/sandbox.ts` - Still exists but no longer used (VM sandbox for code execution)
- API key support - CLI only now

## References
- Gemini CLI Docs: https://geminicli.com/docs/
- Agent Skills: https://geminicli.com/docs/cli/skills/
- Headless Mode: https://geminicli.com/docs/cli/headless/
- Vending-Bench 2: https://andonlabs.com/evals/vending-bench-2
- Original Spec: `GeminiBotSpec.md` in repo root


