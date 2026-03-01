/**
 * Ralph Loop Controller
 * 
 * The main agent loop that:
 * 1. Reads tasks from the queue
 * 2. Loads the appropriate skill + protocol context
 * 3. Calls Gemini to generate code
 * 4. Executes code in sandbox
 * 5. Retries on failure with error context
 * 
 * Based on the "Ralph" architecture pattern.
 * @see https://ghuntley.com/ralph/
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getConfig, type Config } from './lib/config.js';
import { createLogger } from './lib/logger.js';
import { callGeminiWithSkill, type GeminiResponse } from './lib/gemini.js';
import { validateAndCheck } from './lib/validation.js';
import * as db from './tools/db.js';
import * as entities from './tools/entities.js';
import * as output from './tools/output.js';
import prisma from './lib/prisma.js';
import { PromptStore, runRlm, type PromptSectionInput } from './rlm/index.js';
import { notifyDiscord } from './lib/notify.js';
import { readProtocolSummary, writeProtocolSummary, upsertFact } from './lib/memory.js';

const log = createLogger('Agent');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Map task types to Gemini CLI skill names (auto-discovered from .gemini/skills/)
const SKILL_NAME_MAP: Record<string, string> = {
  FORUM_UPDATE: 'governance-watchdog',
  REPO_ONBOARD: 'repo-walker',
  GOVERNANCE_SUMMARY: 'governance-watchdog',
  ENTITY_PROFILE: 'entity-profiles',
  PROTOCOL_DOCS: 'protocol-docs',
};

// Task descriptions for Gemini
const TASK_DESCRIPTIONS: Record<string, string> = {
  FORUM_UPDATE: 'Analyze the provided forum posts and generate a governance state summary with entity observations.',
  REPO_ONBOARD: 'Analyze the repository structure and generate a technical summary.',
  GOVERNANCE_SUMMARY: 'Generate an updated governance summary from the context.',
  ENTITY_PROFILE: 'Generate a profile for the specified entity based on their forum activity.',
  PROTOCOL_DOCS: 'Generate documentation pages from the source documents.',
};

// RLM integration: use recursive tools when context is too large for a single prompt
const RLM_ELIGIBLE_TASKS = new Set<string>([
  'FORUM_UPDATE',
  'GOVERNANCE_SUMMARY',
  'ENTITY_PROFILE',
  'PROTOCOL_DOCS',
]);

const RLM_ALWAYS_ON_TASKS = new Set<string>([
  'REPO_ONBOARD',
]);

const SKILL_DOC_PATHS: Record<string, string> = {
  'governance-watchdog': '.gemini/skills/governance/SKILL.md',
  'entity-profiles': '.gemini/skills/entity-profiles/SKILL.md',
  'repo-walker': '.gemini/skills/onboarding/SKILL.md',
  'protocol-docs': '.gemini/skills/protocol-docs/SKILL.md',
};

const RLM_OUTPUT_HINTS: Record<string, string> = {
  FORUM_UPDATE:
    'Return JSON with governanceSummary (markdown string), entities (array of {identifier, activityLevel, observation, observationType, confidence}), maxProcessedPostId (number), insights (array of strings).',
  GOVERNANCE_SUMMARY:
    'Return JSON with governanceSummary (markdown string), entities (array of {identifier, activityLevel, observation, observationType, confidence}), maxProcessedPostId (number), insights (array of strings).',
  ENTITY_PROFILE:
    'Return JSON with entityType, displayName, bio, profile {overview, areasOfFocus, keyPositions?, communicationStyle?, activityMetrics?}, shouldDraft, draftReason?, sourcePostIds?.',
  REPO_ONBOARD:
    'Return JSON with technicalSummary, projectType, structure, contracts, governanceSurface, documentation, gaps, sourceDocsToSave.',
  PROTOCOL_DOCS:
    'Return JSON with page {title, path, content, pageType}, metadata?, shouldDraft, draftReason?.',
};

// ============================================================================
// Hybrid Forum Delay Logic
// ============================================================================

/**
 * Calculate days between two dates
 */
function daysBetween(date1: Date, date2: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((date2.getTime() - date1.getTime()) / msPerDay);
}

/**
 * Check if a forum post should be processed based on hybrid delay rules:
 * - Minimum delay: forumDelayDays after post creation
 * - Activity check: forumQuietDays without new replies
 */
export function shouldProcessPost(
  post: { createdAt: Date; topic: { lastPostedAt: Date | null } },
  config: { forumDelayDays: number; forumQuietDays: number }
): boolean {
  const now = new Date();
  const daysSinceCreation = daysBetween(post.createdAt, now);
  const lastActivity = post.topic.lastPostedAt ?? post.createdAt;
  const daysSinceLastReply = daysBetween(lastActivity, now);
  
  // Must meet minimum delay AND have quiet period
  return daysSinceCreation >= config.forumDelayDays && 
         daysSinceLastReply >= config.forumQuietDays;
}

/**
 * Get forum posts ready for processing (meeting delay criteria)
 */
export async function getReadyForumPosts(
  protocolId: string,
  lastProcessedId: number,
  limit: number = 20
): Promise<db.ForumPost[]> {
  // Get protocol context for delay config
  const context = await db.getProtocolContext(protocolId);
  const delayConfig = {
    forumDelayDays: context?.forumDelayDays ?? 7,
    forumQuietDays: context?.forumQuietDays ?? 2,
  };

  // Resolve governance space so we only process this protocol's forum posts.
  const protocol = await db.getProtocol(protocolId);
  const spaceId = protocol?.governanceSpace?.id ?? undefined;

  if (!spaceId) {
    log.warn(`No governance space found for protocol ${protocolId}; skipping forum fetch`);
    return [];
  }
  
  // Fetch more posts than needed, then filter
  const posts = await db.getForumPostsAfter(lastProcessedId, {
    spaceId,
    limit: limit * 3, // Fetch extra to account for filtering
  });
  
  // Filter by hybrid delay rules
  const readyPosts = posts.filter(post => shouldProcessPost(post, delayConfig));
  
  return readyPosts.slice(0, limit);
}

/**
 * Load protocol-specific knowledge files
 * All are included in the data sent to Gemini CLI
 */
async function loadProtocolKnowledge(protocolSlug: string): Promise<{
  context: string | null;
  learnings: string | null;
  onboarding: string | null;
}> {
  const protocolDir = path.join(__dirname, '..', '.gemini', 'protocols', protocolSlug);
  
  let context: string | null = null;
  let learnings: string | null = null;
  let onboarding: string | null = null;
  
  try {
    context = await fs.readFile(path.join(protocolDir, 'CONTEXT.md'), 'utf-8');
  } catch {
    // No context file
  }
  
  try {
    learnings = await fs.readFile(path.join(protocolDir, 'LEARNINGS.md'), 'utf-8');
  } catch {
    // No learnings file yet
  }
  
  try {
    onboarding = await fs.readFile(path.join(protocolDir, 'ONBOARDING.md'), 'utf-8');
  } catch {
    // No onboarding file (only needed during initial setup)
  }
  
  return { context, learnings, onboarding };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getContextBytes(context: Record<string, unknown>): number {
  try {
    return Buffer.byteLength(JSON.stringify(context), 'utf8');
  } catch {
    return 0;
  }
}

function shouldUseRlm(
  task: db.AgentTask,
  taskContext: Record<string, unknown>,
  config: Config
): boolean {
  if (!config.RLM_ENABLED) return false;
  if (RLM_ALWAYS_ON_TASKS.has(task.type)) return true;
  const payload = task.payload as { onboarding?: boolean } | null;
  if (payload?.onboarding) return true;
  if (!RLM_ELIGIBLE_TASKS.has(task.type)) return false;
  const postCount = typeof taskContext.postCount === 'number' ? taskContext.postCount : 0;
  if (postCount >= config.RLM_MIN_POSTS) return true;
  return getContextBytes(taskContext) >= config.RLM_CONTEXT_BYTES_THRESHOLD;
}

async function loadSkillDoc(skillName: string): Promise<string | null> {
  const skillPath = SKILL_DOC_PATHS[skillName];
  if (!skillPath) return null;
  try {
    return await fs.readFile(path.join(__dirname, '..', skillPath), 'utf-8');
  } catch {
    return null;
  }
}

function formatLabel(parts: string[]): string {
  return parts.map(part => part.trim()).filter(Boolean).join(' | ');
}

function buildPostSection(
  prefix: string,
  post: Record<string, unknown>,
  index: number
): PromptSectionInput {
  const idValue = (post.discoursePostId ?? post.id ?? index) as string | number;
  const id = String(idValue);
  const author = String(post.authorUsername ?? post.authorDisplayName ?? '').trim();
  const topic = String((post.topic as Record<string, unknown> | undefined)?.title ?? '').trim();
  const createdAt = String(post.createdAt ?? '').trim();
  const content = String(post.content ?? '').trim();

  const headerLines = [
    `PostId: ${id}`,
    author ? `Author: ${author}` : '',
    createdAt ? `CreatedAt: ${createdAt}` : '',
    topic ? `Topic: ${topic}` : '',
    String((post.topic as Record<string, unknown> | undefined)?.url ?? '').trim()
      ? `TopicUrl: ${(post.topic as Record<string, unknown> | undefined)?.url}`
      : '',
  ].filter(Boolean);

  return {
    id: `${prefix}-${id}`,
    label: formatLabel([prefix, id, author, topic]),
    content: `${headerLines.join('\n')}\n\n${content}`.trim(),
    meta: {
      id: post.id,
      discoursePostId: post.discoursePostId,
      authorUsername: post.authorUsername,
      authorDisplayName: post.authorDisplayName,
      createdAt: post.createdAt,
      likeCount: post.likeCount,
      topic: post.topic,
    },
  };
}

function buildObservationSection(
  observation: Record<string, unknown>,
  index: number
): PromptSectionInput {
  const id = String(observation.id ?? index);
  const identifier = String(observation.entityIdentifier ?? '').trim();
  return {
    id: `observation-${id}`,
    label: formatLabel(['observation', identifier]),
    content: String(observation.content ?? '').trim(),
    meta: observation,
  };
}

function buildRlmTaskPrompt(taskType: string, taskDescription: string, skillName: string): string {
  return [
    taskDescription,
    `Task type: ${taskType}.`,
    'Use recursive tool actions to inspect sections and gather evidence.',
    'If needed, use DB tool actions to retrieve more context within the protocol scope.',
    skillName ? `Skill instructions are in the "skill" section.` : 'Follow the task description and output schema.',
    'Return the final answer via a final action.',
  ].join('\n');
}

function buildRlmDbScope(task: db.AgentTask, taskContext: Record<string, unknown>): {
  protocolId?: string;
  spaceId?: string | null;
  lastProcessedPostId?: number;
} | undefined {
  const protocol = taskContext.protocol as { governanceSpace?: { id?: string | null } } | undefined;
  const protocolContext = taskContext.protocolContext as { lastProcessedPostId?: number } | undefined;
  const scope = {
    protocolId: task.protocolId ?? undefined,
    spaceId: protocol?.governanceSpace?.id ?? null,
    lastProcessedPostId: protocolContext?.lastProcessedPostId,
  };
  if (!scope.spaceId) return undefined;
  return scope;
}

function buildRlmSections(params: {
  task: db.AgentTask;
  taskContext: Record<string, unknown>;
  taskDescription: string;
  skillName: string;
  skillDoc: string | null;
}): PromptSectionInput[] {
  const { task, taskContext, taskDescription, skillName, skillDoc } = params;
  const sections: PromptSectionInput[] = [];

  const posts = Array.isArray(taskContext.posts)
    ? (taskContext.posts as Record<string, unknown>[])
    : [];
  const entityPosts = Array.isArray(taskContext.entityPosts)
    ? (taskContext.entityPosts as Record<string, unknown>[])
    : [];
  const observations = Array.isArray(taskContext.existingObservations)
    ? (taskContext.existingObservations as Record<string, unknown>[])
    : [];
  const maxDiscoursePostId = posts.reduce((max, post) => {
    const value = Number(post.discoursePostId);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);

  const protocol = taskContext.protocol as { governanceSpace?: { id?: string | null } } | undefined;
  const protocolContext = taskContext.protocolContext as { lastProcessedPostId?: number } | undefined;

  const taskMeta = {
    taskId: task.id,
    taskType: task.type,
    protocolId: task.protocolId,
    attempt: task.attempts + 1,
    postCount: posts.length,
    entityPostCount: entityPosts.length,
    observationCount: observations.length,
    maxDiscoursePostId,
    governanceSpaceId: protocol?.governanceSpace?.id ?? null,
    lastProcessedPostId: protocolContext?.lastProcessedPostId ?? null,
    previousError: taskContext.previousError ?? null,
  };

  sections.push({
    id: 'task',
    label: 'task meta',
    content: safeJson(taskMeta),
  });

  sections.push({
    id: 'task-description',
    label: 'task description',
    content: taskDescription,
  });

  if (skillDoc) {
    sections.push({
      id: 'skill',
      label: `skill ${skillName}`,
      content: skillDoc,
    });
  }

  if (taskContext.payload) {
    sections.push({
      id: 'task-payload',
      label: 'task payload',
      content: safeJson(taskContext.payload),
    });
  }

  if (taskContext.protocol) {
    sections.push({
      id: 'protocol',
      label: 'protocol metadata',
      content: safeJson(taskContext.protocol),
    });
  }

  if (taskContext.protocolContext) {
    sections.push({
      id: 'protocol-context',
      label: 'protocol context',
      content: safeJson(taskContext.protocolContext),
    });
  }

  if (taskContext.currentGovernanceState) {
    sections.push({
      id: 'current-governance-state',
      label: 'current governance state',
      content: String(taskContext.currentGovernanceState),
    });
  }

  if (taskContext.protocolKnowledgeDoc) {
    sections.push({
      id: 'protocol-knowledge',
      label: 'protocol knowledge',
      content: String(taskContext.protocolKnowledgeDoc),
    });
  }

  if (taskContext.protocolLearningsDoc) {
    sections.push({
      id: 'protocol-learnings',
      label: 'protocol learnings',
      content: String(taskContext.protocolLearningsDoc),
    });
  }

  if (taskContext.archivistOnboardingNotes) {
    sections.push({
      id: 'archivist-onboarding',
      label: 'archivist onboarding',
      content: String(taskContext.archivistOnboardingNotes),
    });
  }

  if (posts.length > 0) {
    for (let i = 0; i < posts.length; i++) {
      sections.push(buildPostSection('post', posts[i], i));
    }
  }

  if (entityPosts.length > 0) {
    for (let i = 0; i < entityPosts.length; i++) {
      sections.push(buildPostSection('entity-post', entityPosts[i], i));
    }
  }

  if (observations.length > 0) {
    for (let i = 0; i < observations.length; i++) {
      sections.push(buildObservationSection(observations[i], i));
    }
  }

  return sections;
}

function parseRlmResult(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  if (typeof result === 'string') {
    const trimmed = result.trim();
    if (!trimmed) {
      throw new Error('RLM returned empty result string');
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }
  throw new Error('RLM result must be a JSON object');
}

/**
 * Build task context for the LLM
 * 
 * Key design: Load as much relevant data as possible upfront.
 * Gemini excels at processing large context, not at multi-step reasoning.
 */
async function buildTaskContext(task: db.AgentTask): Promise<Record<string, unknown>> {
  const config = getConfig();
  
  const context: Record<string, unknown> = {
    taskId: task.id,
    taskType: task.type,
    protocolId: task.protocolId,
    payload: task.payload,
    attempt: task.attempts + 1,
  };
  
  // Add protocol context if available
  if (task.protocolId) {
    const protocolContext = await db.getProtocolContext(task.protocolId);
    if (protocolContext) {
      context.protocolContext = {
        lastProcessedPostId: protocolContext.lastProcessedPostId,
        hasGovernanceState: !!protocolContext.governanceState,
        hasTechnicalSummary: !!protocolContext.technicalSummary,
        isOnboarded: protocolContext.isOnboarded,
        forumDelayDays: protocolContext.forumDelayDays,
        forumQuietDays: protocolContext.forumQuietDays,
      };
      
      // Include current governance state for context
      if (protocolContext.governanceState) {
        context.currentGovernanceState = protocolContext.governanceState;
      }
    }
    
    const protocol = await db.getProtocol(task.protocolId);
    if (protocol) {
      context.protocol = protocol;
    }
    
    // For FORUM_UPDATE tasks, pre-load posts into context
    // Gemini can handle large batches - load 100+ posts at once
    if (task.type === 'FORUM_UPDATE' && protocolContext) {
      const posts = await getReadyForumPosts(
        task.protocolId,
        protocolContext.lastProcessedPostId,
        config.FORUM_BATCH_SIZE
      );
      
      if (posts.length > 0) {
        // Include full post data for Gemini to analyze
        context.posts = posts.map(p => ({
          id: p.id,
          discoursePostId: p.discoursePostId,
          authorUsername: p.authorUsername,
          authorDisplayName: p.authorDisplayName,
          createdAt: p.createdAt,
          likeCount: p.likeCount,
          // Use raw content if available, fall back to cooked
          content: p.rawContent || p.cookedContent || '',
          topic: {
            title: p.topic.title,
            slug: p.topic.slug,
            url: p.topic.url,
          },
        }));
        context.postCount = posts.length;
        log.info(`Loaded ${posts.length} posts into context for analysis`);
      } else {
        context.posts = [];
        context.postCount = 0;
      }
    }
    
    // For ENTITY_PROFILE tasks, pre-load entity data
    if (task.type === 'ENTITY_PROFILE' && task.payload) {
      const payload = task.payload as { entityType?: string; identifier?: string };
      if (payload.entityType && payload.identifier) {
        // Load entity's posts
        const posts = await db.getPostsByAuthor(payload.identifier, { limit: 50 });
        context.entityPosts = posts.map(p => ({
          id: p.id,
          createdAt: p.createdAt,
          content: p.rawContent || p.cookedContent || '',
          topic: { title: p.topic.title },
          likeCount: p.likeCount,
        }));
        
        // Load existing observations
        const observations = await db.getEntityObservations(payload.identifier, { limit: 30 });
        context.existingObservations = observations;
      }
    }
  }
  
  // Add previous error if retrying
  if (task.lastError) {
    context.previousError = task.lastError;
    context.retryHint = 'The previous attempt failed. Please fix the issue and try again.';
  }

  // Add protocol memory summary if available
  if (task.protocolId) {
    const protocol = context.protocol as { slug?: string } | undefined;
    if (protocol?.slug) {
      const memorySummary = await readProtocolSummary(protocol.slug);
      if (memorySummary) {
        context.protocolMemorySummary = memorySummary;
      }
    }
  }
  
  return context;
}

/**
 * Parse and persist Gemini's governance analysis response
 */
async function persistGovernanceResult(
  protocolId: string,
  result: {
    governanceSummary?: string;
    entities?: Array<{
      identifier: string;
      activityLevel?: string;
      observation: string;
      observationType: string;
      confidence?: number;
    }>;
    maxProcessedPostId?: number;
    insights?: string[];
  }
): Promise<void> {
  // Update governance state
  if (result.governanceSummary) {
    await db.upsertProtocolContext(protocolId, {
      governanceState: result.governanceSummary,
      lastProcessedPostId: result.maxProcessedPostId,
    });
    log.info('Updated governance state');
  }
  
  // Record entity observations
  if (result.entities?.length) {
    for (const entity of result.entities) {
      await db.addEntityObservation({
        entityIdentifier: entity.identifier,
        entityType: entity.observationType as db.EntityType,
        content: entity.observation,
        confidenceScore: entity.confidence ?? 70,
      });
    }
    log.info(`Recorded ${result.entities.length} entity observations`);
  }
}

/**
 * Parse and persist entity profile result
 */
async function persistEntityProfileResult(
  protocolId: string,
  result: Record<string, unknown>
): Promise<void> {
  const data = result as {
    entityType: entities.EntityType;
    displayName: string;
    bio: string;
    profile: {
      overview: string;
      areasOfFocus: string[];
      keyPositions?: Array<{ topic: string; stance: string; quote?: string; date?: string }>;
      communicationStyle?: string;
      activityMetrics?: { postsAnalyzed: number; firstSeen?: string; lastSeen?: string; topTopics?: string[] };
    };
    shouldDraft: boolean;
    draftReason?: string;
    sourcePostIds?: string[];
  };
  
  // Build profile content markdown
  const profileContent = `# ${data.displayName}

> ${data.bio}

## Overview

${data.profile.overview}

## Areas of Focus

${data.profile.areasOfFocus.map(a => `- ${a}`).join('\n')}

${data.profile.keyPositions?.length ? `## Key Positions

${data.profile.keyPositions.map(p => `### On ${p.topic}
${p.quote ? `> "${p.quote}"${p.date ? ` - ${p.date}` : ''}\n\n` : ''}${p.stance}`).join('\n\n')}` : ''}

${data.profile.communicationStyle ? `## Communication Style

${data.profile.communicationStyle}` : ''}

${data.profile.activityMetrics ? `## Activity Summary

| Metric | Value |
|--------|-------|
| Posts Analyzed | ${data.profile.activityMetrics.postsAnalyzed} |
${data.profile.activityMetrics.firstSeen ? `| First Seen | ${data.profile.activityMetrics.firstSeen} |` : ''}
${data.profile.activityMetrics.lastSeen ? `| Last Seen | ${data.profile.activityMetrics.lastSeen} |` : ''}
${data.profile.activityMetrics.topTopics?.length ? `| Top Topics | ${data.profile.activityMetrics.topTopics.join(', ')} |` : ''}` : ''}
`;

  // Get the entity identifier from the task payload
  const identifier = data.displayName.toLowerCase().replace(/\s+/g, '-');
  
  if (data.shouldDraft) {
    // Save as draft for review
    await output.saveDraft(protocolId, `governance/entities/${identifier}`, {
      title: `${data.displayName} Profile`,
      content: profileContent,
      draftType: 'ENTITY_PROFILE',
      sourceRefs: data.sourcePostIds,
    });
    log.info(`Created draft profile for ${data.displayName}: ${data.draftReason}`);
  } else {
    // Auto-publish
    await entities.upsertEntity(protocolId, data.entityType, identifier, {
      displayName: data.displayName,
      bio: data.bio,
      profileContent,
      isPublished: true,
    });
    log.info(`Published profile for ${data.displayName}`);
  }
}

/**
 * Parse and persist repo onboard result
 */
async function persistRepoOnboardResult(
  protocolId: string,
  result: Record<string, unknown>
): Promise<void> {
  const data = result as {
    technicalSummary: string;
    projectType: string;
    structure?: { contractsPath?: string; testsPath?: string; configFiles?: string[] };
    contracts?: Array<{ name: string; path: string; purpose?: string; hasGovernanceFunctions?: boolean }>;
    governanceSurface?: { accessControlPattern?: string; adminRoles?: string[]; hasTimelock?: boolean };
    documentation?: { hasReadme: boolean; readmeSummary?: string };
    gaps?: string[];
    sourceDocsToSave?: Array<{ sourceType: string; title: string; content: string; sourceUrl?: string }>;
  };
  
  // Save technical summary to protocol context
  await db.upsertProtocolContext(protocolId, {
    technicalSummary: data.technicalSummary,
  });
  log.info('Saved technical summary');
  
  // Save any source docs
  if (data.sourceDocsToSave?.length) {
    for (const doc of data.sourceDocsToSave) {
      await output.upsertSourceDoc(protocolId, {
        sourceType: doc.sourceType as output.SourceDocType,
        title: doc.title,
        content: doc.content,
        sourceUrl: doc.sourceUrl,
      });
    }
    log.info(`Saved ${data.sourceDocsToSave.length} source documents`);
  }
  
  // Log summary
  log.info(`Repo analysis complete: ${data.projectType}, ${data.contracts?.length ?? 0} contracts found`);
  if (data.gaps?.length) {
    log.info(`Gaps identified: ${data.gaps.join(', ')}`);
  }
}

/**
 * Parse and persist protocol docs result
 */
async function persistProtocolDocsResult(
  protocolId: string,
  result: Record<string, unknown>
): Promise<void> {
  const data = result as {
    page: {
      title: string;
      path: string;
      content: string;
      pageType: string;
    };
    metadata?: {
      sourceDocIds?: string[];
      crossReferences?: Array<{ path: string; context?: string }>;
      governanceRelevance?: string;
      accuracyNotes?: string[];
    };
    shouldDraft: boolean;
    draftReason?: string;
  };
  
  // Save as draft (docs always go through review)
  await output.saveDraft(protocolId, data.page.path, {
    title: data.page.title,
    content: data.page.content,
    draftType: 'PAGE',
    sourceRefs: data.metadata?.sourceDocIds,
  });
  
  log.info(`Created ${data.page.pageType} page draft: ${data.page.path}`);
  if (data.draftReason) {
    log.info(`Reason: ${data.draftReason}`);
  }
}

/**
 * Execute a single task using Gemini CLI's native skill system
 * 
 * The new approach:
 * 1. Build context data
 * 2. Call Gemini CLI with skill hint
 * 3. Parse JSON response
 * 4. Persist results to database
 */
async function executeTask(task: db.AgentTask): Promise<boolean> {
  const skillName = SKILL_NAME_MAP[task.type];
  const taskDescription = TASK_DESCRIPTIONS[task.type];
  const config = getConfig();
  let taskContext: Record<string, unknown> | null = null;
  let usedRlm = false;
  
  if (!skillName) {
    log.error(`Unknown task type: ${task.type}`);
    await db.updateTaskStatus(task.id, 'FAILED', `Unknown task type: ${task.type}`);
    return false;
  }
  
  log.info(`Processing task ${task.id} (${task.type}) - Attempt ${task.attempts + 1}/${task.maxAttempts}`);
  
  // Mark as running
  await db.updateTaskStatus(task.id, 'RUNNING');
  
  const startTime = Date.now();
  
  try {
    // 1. Build task context (includes posts, entity data, etc.)
    taskContext = await buildTaskContext(task);
    
    // 2. Add protocol knowledge docs (CONTEXT.md + LEARNINGS.md + ONBOARDING.md)
    if (task.protocolId) {
      const protocol = await db.getProtocol(task.protocolId);
      if (protocol) {
        const knowledge = await loadProtocolKnowledge(protocol.slug);
        if (knowledge.context) {
          taskContext.protocolKnowledgeDoc = knowledge.context;
          log.debug('Loaded protocol CONTEXT.md for:', protocol.slug);
        }
        if (knowledge.learnings) {
          taskContext.protocolLearningsDoc = knowledge.learnings;
          log.debug('Loaded protocol LEARNINGS.md for:', protocol.slug);
        }
        // Onboarding notes from archivist (only during initial setup)
        if (knowledge.onboarding) {
          taskContext.archivistOnboardingNotes = knowledge.onboarding;
          log.info('Loaded archivist ONBOARDING.md for:', protocol.slug);
        }
      }
    }
    
    log.debug('Task context post count:', taskContext.postCount ?? 0);

    // 3. Decide whether to use RLM scaffold
    const useRlm = shouldUseRlm(task, taskContext, config);
    usedRlm = useRlm;

    let parsedResult: Record<string, unknown>;
    let rawOutput = '';
    let stats: GeminiResponse['stats'] | undefined;

    if (useRlm) {
      log.info(`Using RLM scaffold for task ${task.id}`);

      const skillDoc = await loadSkillDoc(skillName);
      const sections = buildRlmSections({
        task,
        taskContext,
        taskDescription,
        skillName,
        skillDoc,
      });
      const store = await PromptStore.fromSections(`task-${task.id}`, sections, {
        chunkBytes: config.RLM_CHUNK_BYTES,
        workspaceDir: path.join(config.AGENT_WORKSPACE, 'rlm'),
      });

      const dbScope = buildRlmDbScope(task, taskContext);

      const rlmResult = await runRlm({
        store,
        task: buildRlmTaskPrompt(task.type, taskDescription, skillName),
        expectedOutput: RLM_OUTPUT_HINTS[task.type] ?? 'Return a JSON object with the task output.',
        options: {
          model: config.GEMINI_MODEL,
          skillName: 'recursive-tools',
          workingDir: path.join(__dirname, '..'),
          chunkBytes: config.RLM_CHUNK_BYTES,
          maxSteps: config.RLM_MAX_STEPS,
          maxDepth: config.RLM_MAX_DEPTH,
          maxReadBytes: config.RLM_MAX_READ_BYTES,
          maxSectionBytes: config.RLM_MAX_SECTION_BYTES,
          maxSearchResults: config.RLM_MAX_SEARCH_RESULTS,
          maxToolResultChars: config.RLM_MAX_TOOL_RESULT_CHARS,
          workspaceDir: path.join(config.AGENT_WORKSPACE, 'rlm'),
          dbScope,
        },
      });

      if (!rlmResult.ok) {
        throw new Error(`RLM failed: ${rlmResult.error ?? 'Unknown error'}`);
      }

      parsedResult = parseRlmResult(rlmResult.result);
      rawOutput = safeJson(parsedResult);
    } else {
      // 3. Call Gemini CLI (skills auto-discovered from .gemini/skills/)
      log.info(`Calling Gemini CLI with skill: ${skillName}`);

      const geminiResponse = await callGeminiWithSkill(
        skillName,
        taskDescription,
        taskContext,
        {
          workingDir: path.join(__dirname, '..'), // Agent workspace root
          timeoutMs: 300000, // 5 minutes for large context processing
        }
      );

      if (!geminiResponse.success) {
        throw new Error(`Gemini CLI failed: ${geminiResponse.error}`);
      }

      if (!geminiResponse.response) {
        throw new Error('Gemini returned empty response');
      }

      stats = geminiResponse.stats;
      rawOutput = geminiResponse.response;

      // 4. Parse structured response
      try {
        parsedResult = JSON.parse(geminiResponse.response);
      } catch (parseError) {
        // If not valid JSON, log and treat as success but warn
        log.warn('Response was not valid JSON, raw output:', geminiResponse.response.slice(0, 500));
        throw new Error('Invalid JSON response from Gemini');
      }
    }
    
    // 5. Validate response (schema + quality checks)
    const validationContext = {
      postCount: taskContext.postCount as number | undefined,
      entityIdentifier: (taskContext.entity as { identifier?: string })?.identifier,
    };
    
    const validation = validateAndCheck(task.type, parsedResult, validationContext);
    
    if (!validation.valid) {
      log.error('Validation failed:', validation.errors);
      throw new Error(`Validation failed: ${validation.errors?.join(', ')}`);
    }
    
    if (validation.warnings?.length) {
      log.warn('Validation warnings:', validation.warnings);
    }
    
    // Use validated/transformed data
    const validatedResult = validation.data as Record<string, unknown>;
    
    // 6. Persist results based on task type
    if (task.type === 'FORUM_UPDATE' || task.type === 'GOVERNANCE_SUMMARY') {
      await persistGovernanceResult(task.protocolId!, validatedResult as Parameters<typeof persistGovernanceResult>[1]);
    } else if (task.type === 'ENTITY_PROFILE') {
      await persistEntityProfileResult(task.protocolId!, validatedResult);
    } else if (task.type === 'REPO_ONBOARD') {
      await persistRepoOnboardResult(task.protocolId!, validatedResult);
    } else if (task.type === 'PROTOCOL_DOCS') {
      await persistProtocolDocsResult(task.protocolId!, validatedResult);
    }

    // 6b. Refresh protocol memory summary/facts
    if (task.protocolId) {
      const protocol = await db.getProtocol(task.protocolId);
      const context = await db.getProtocolContext(task.protocolId);
      if (protocol && context) {
        const summary = [
          `# ${protocol.title} (${protocol.slug})`,
          '',
          '## Governance State',
          context.governanceState ?? 'No governance summary yet.',
          '',
          '## Technical Summary',
          context.technicalSummary ?? 'No technical summary yet.',
          '',
          '## Processing',
          `- Last processed post ID: ${context.lastProcessedPostId}`,
          `- Forum delay: ${context.forumDelayDays} days`,
          `- Forum quiet: ${context.forumQuietDays} days`,
        ].join('\n');
        await writeProtocolSummary(protocol.slug, summary);

        const now = new Date().toISOString();
        if (context.governanceState) {
          await upsertFact({
            slug: protocol.slug,
            category: 'governance_state',
            fact: context.governanceState,
            source: 'agent',
            timestamp: now,
          });
        }
        if (context.technicalSummary) {
          await upsertFact({
            slug: protocol.slug,
            category: 'technical_summary',
            fact: context.technicalSummary,
            source: 'agent',
            timestamp: now,
          });
        }
        await upsertFact({
          slug: protocol.slug,
          category: 'processing_cursor',
          fact: `lastProcessedPostId=${context.lastProcessedPostId}`,
          source: 'agent',
          timestamp: now,
        });
        await upsertFact({
          slug: protocol.slug,
          category: 'forum_delay',
          fact: `forumDelayDays=${context.forumDelayDays}, forumQuietDays=${context.forumQuietDays}`,
          source: 'agent',
          timestamp: now,
        });
      }
    }
    
    // 7. Log execution
    await db.logExecution({
      taskId: task.id,
      skillName: useRlm ? `${task.type}:RLM` : task.type,
      generatedCode: rawOutput, // Store raw response for debugging
      success: true,
      executionMs: Date.now() - startTime,
    });
    
    // Success!
    await db.updateTaskStatus(task.id, 'COMPLETED');
    log.info(`Task ${task.id} completed successfully in ${Date.now() - startTime}ms`);
    
    // Log token usage if available
    if (stats?.models) {
      const models = Object.keys(stats.models);
      for (const model of models) {
        const tokens = stats.models[model].tokens;
        if (tokens?.total) {
          log.info(`Token usage (${model}): ${tokens.total} total`);
        }
      }
    }
    
    return true;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Task ${task.id} failed:`, errorMessage);
    
    // Log failed execution
    await db.logExecution({
      taskId: task.id,
      skillName: task.type,
      success: false,
      errorMessage,
      executionMs: Date.now() - startTime,
    });
    
    // Check if we should retry
    const protocol = taskContext?.protocol as { slug?: string; title?: string } | undefined;
    const protocolLabel = protocol?.slug ?? task.protocolId ?? 'unknown';

    if (task.attempts + 1 >= task.maxAttempts) {
      await db.updateTaskStatus(task.id, 'FAILED', errorMessage);
      log.error(`Task ${task.id} failed permanently after ${task.maxAttempts} attempts`);

      await notifyDiscord('task_failed', {
        title: `Task failed: ${task.type}`,
        description: errorMessage,
        fields: [
          { name: 'Task ID', value: task.id, inline: true },
          { name: 'Protocol', value: protocolLabel, inline: true },
          { name: 'Attempts', value: `${task.attempts + 1}/${task.maxAttempts}`, inline: true },
          { name: 'RLM', value: usedRlm ? 'true' : 'false', inline: true },
        ],
        color: 0xd62828,
      });
    } else {
      // Reset to pending for retry (attempts already incremented)
      await db.updateTaskStatus(task.id, 'PENDING', errorMessage);
      log.warn(`Task ${task.id} will be retried`);

      await notifyDiscord('task_error', {
        title: `Task error: ${task.type}`,
        description: errorMessage,
        fields: [
          { name: 'Task ID', value: task.id, inline: true },
          { name: 'Protocol', value: protocolLabel, inline: true },
          { name: 'Attempts', value: `${task.attempts + 1}/${task.maxAttempts}`, inline: true },
          { name: 'RLM', value: usedRlm ? 'true' : 'false', inline: true },
        ],
        color: 0xfb8500,
      });
    }
    
    return false;
  }
}

/**
 * Process all pending tasks
 */
export async function processTasks(): Promise<{ processed: number; succeeded: number }> {
  const config = getConfig();
  let processed = 0;
  let succeeded = 0;
  
  log.info('Starting task processing...');
  
  while (processed < config.MAX_POSTS_PER_RUN) {
    const task = await db.getNextTask();
    
    if (!task) {
      log.info('No more pending tasks');
      break;
    }
    
    processed++;
    const success = await executeTask(task);
    if (success) succeeded++;
    
    // Small delay between tasks
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  log.info(`Task processing complete: ${succeeded}/${processed} succeeded`);
  
  return { processed, succeeded };
}

/**
 * Create recurring tasks for onboarded protocols only
 */
export async function createRecurringTasks(): Promise<number> {
  // Only process protocols that have been onboarded
  const onboardedContexts = await prisma.protocolAgentContext.findMany({
    where: { isOnboarded: true },
    select: { protocolId: true },
  });
  
  let created = 0;
  
  for (const ctx of onboardedContexts) {
    // Check if there's already a pending FORUM_UPDATE task
    const existingTask = await prisma.agentTask.findFirst({
      where: {
        protocolId: ctx.protocolId,
        type: 'FORUM_UPDATE',
        status: { in: ['PENDING', 'RUNNING'] },
      },
    });
    
    if (!existingTask) {
      await db.createTask({
        type: 'FORUM_UPDATE',
        protocolId: ctx.protocolId,
        priority: 1,
      });
      created++;
      log.info(`Created FORUM_UPDATE task for protocol ${ctx.protocolId}`);
    }
  }
  
  return created;
}

// ============================================================================
// Onboarding Functions
// ============================================================================

/**
 * Onboard a new protocol - creates initial context and tasks
 */
export async function onboardProtocol(protocolId: string): Promise<void> {
  const protocol = await db.getProtocol(protocolId);
  
  if (!protocol) {
    throw new Error(`Protocol not found: ${protocolId}`);
  }
  
  log.info(`Onboarding protocol: ${protocol.slug}`);
  
  // Create or update protocol context
  await db.upsertProtocolContext(protocolId, {
    governanceState: `Onboarding started at ${new Date().toISOString()}`,
  });
  
  // Mark as onboarded
  await prisma.protocolAgentContext.update({
    where: { protocolId },
    data: {
      isOnboarded: true,
      onboardedAt: new Date(),
    },
  });
  
  // Create initial tasks
  const tasks: Array<{ type: db.TaskType; priority: number }> = [
    { type: 'ENTITY_PROFILE', priority: 3 },  // First: discover entities
    { type: 'PROTOCOL_DOCS', priority: 2 },   // Then: generate docs
    { type: 'FORUM_UPDATE', priority: 1 },    // Finally: process forum
  ];
  
  for (const task of tasks) {
    await db.createTask({
      type: task.type,
      protocolId,
      priority: task.priority,
      payload: { onboarding: true },
    });
    log.info(`Created ${task.type} task for ${protocol.slug}`);
  }
  
  log.info(`Protocol ${protocol.slug} onboarded with ${tasks.length} initial tasks`);
}

/**
 * Get onboarding status for a protocol
 */
export async function getOnboardingStatus(protocolId: string): Promise<{
  isOnboarded: boolean;
  onboardedAt: Date | null;
  lastFullSyncAt: Date | null;
  pendingTasks: number;
}> {
  const context = await db.getProtocolContext(protocolId);
  
  const pendingTasks = await prisma.agentTask.count({
    where: {
      protocolId,
      status: { in: ['PENDING', 'RUNNING'] },
    },
  });
  
  return {
    isOnboarded: context?.isOnboarded ?? false,
    onboardedAt: context?.onboardedAt ?? null,
    lastFullSyncAt: context?.lastFullSyncAt ?? null,
    pendingTasks,
  };
}

/**
 * Run a single iteration of the agent loop (for onboarded protocols only)
 */
export async function runOnce(): Promise<void> {
  log.info('=== Agent Run Starting ===');
  
  // Create recurring tasks for onboarded protocols
  const newTasks = await createRecurringTasks();
  if (newTasks > 0) {
    log.info(`Created ${newTasks} recurring tasks`);
  }
  
  // Process pending tasks
  const { processed, succeeded } = await processTasks();
  
  log.info(`=== Agent Run Complete: ${succeeded}/${processed} tasks succeeded ===`);
}
