/**
 * Database Tool for Loa Agent
 * 
 * Provides a typed interface for the agent's generated code to interact with the database.
 * Per Cloudflare's "Code Mode" philosophy: LLMs are better at writing TypeScript code
 * than making tool calls, so we expose a clean API the generated code can import.
 * 
 * @see https://blog.cloudflare.com/code-mode/
 */

import prisma from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';

// ============================================================================
// Agent Context Operations (Agent's "Long-Term Memory")
// ============================================================================

export interface ProtocolContext {
  id: string;
  protocolId: string;
  technicalSummary: string | null;
  governanceState: string | null;
  lastProcessedPostId: number;
  lastProcessedAt: Date | null;
  isOnboarded: boolean;
  onboardedAt: Date | null;
  lastFullSyncAt: Date | null;
  forumDelayDays: number;
  forumQuietDays: number;
  updatedAt: Date;
}

/**
 * Get the agent's context for a protocol (its "memory" of the protocol)
 */
export async function getProtocolContext(protocolId: string): Promise<ProtocolContext | null> {
  return prisma.protocolAgentContext.findUnique({
    where: { protocolId },
  });
}

/**
 * Create or update the agent's protocol context
 */
export async function upsertProtocolContext(
  protocolId: string,
  data: {
    technicalSummary?: string;
    governanceState?: string;
    lastProcessedPostId?: number;
  }
): Promise<ProtocolContext> {
  return prisma.protocolAgentContext.upsert({
    where: { protocolId },
    create: {
      protocolId,
      technicalSummary: data.technicalSummary ?? null,
      governanceState: data.governanceState ?? null,
      lastProcessedPostId: data.lastProcessedPostId ?? 0,
      lastProcessedAt: new Date(),
    },
    update: {
      ...(data.technicalSummary !== undefined && { technicalSummary: data.technicalSummary }),
      ...(data.governanceState !== undefined && { governanceState: data.governanceState }),
      ...(data.lastProcessedPostId !== undefined && { lastProcessedPostId: data.lastProcessedPostId }),
      lastProcessedAt: new Date(),
    },
  });
}

/**
 * Update governance state (append mode adds to existing)
 */
export async function updateGovernanceState(
  protocolId: string,
  newState: string,
  mode: 'replace' | 'append' = 'replace'
): Promise<void> {
  if (mode === 'append') {
    const existing = await getProtocolContext(protocolId);
    const combined = existing?.governanceState 
      ? `${existing.governanceState}\n\n---\n\n${newState}`
      : newState;
    await upsertProtocolContext(protocolId, { governanceState: combined });
  } else {
    await upsertProtocolContext(protocolId, { governanceState: newState });
  }
}

// ============================================================================
// Entity Observation Operations (Agent's "Notebook")
// ============================================================================

export type EntityType = 'DELEGATE_STANCE' | 'DELEGATE_EXPERTISE' | 'DELEGATE_ACTIVITY' | 'AUTHOR_SENTIMENT';

export interface EntityObservation {
  id: string;
  entityIdentifier: string;
  entityType: EntityType;
  content: string;
  sourcePostId: string | null;
  confidenceScore: number;
  createdAt: Date;
}

/**
 * Record an observation about an entity (delegate, forum author)
 */
export async function addEntityObservation(data: {
  entityIdentifier: string;
  entityType: EntityType;
  content: string;
  sourcePostId?: string;
  confidenceScore?: number;
  expiresAt?: Date;
}): Promise<EntityObservation> {
  return prisma.entityObservation.create({
    data: {
      entityIdentifier: data.entityIdentifier,
      entityType: data.entityType,
      content: data.content,
      sourcePostId: data.sourcePostId ?? null,
      confidenceScore: data.confidenceScore ?? 50,
      expiresAt: data.expiresAt ?? null,
    },
  });
}

/**
 * Get observations for an entity
 */
export async function getEntityObservations(
  entityIdentifier: string,
  options?: {
    entityType?: EntityType;
    limit?: number;
    minConfidence?: number;
  }
): Promise<EntityObservation[]> {
  return prisma.entityObservation.findMany({
    where: {
      entityIdentifier,
      ...(options?.entityType && { entityType: options.entityType }),
      ...(options?.minConfidence && { confidenceScore: { gte: options.minConfidence } }),
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 50,
  });
}

// ============================================================================
// Forum Post Operations (Read-only - backend owns these)
// ============================================================================

export interface ForumPost {
  id: string;
  discoursePostId: number;
  topicId: string;
  postNumber: number;
  authorUsername: string | null;
  authorDisplayName: string | null;
  rawContent: string | null;
  cookedContent: string | null;
  createdAt: Date;
  likeCount: number | null;
  topic: {
    title: string;
    slug: string;
    url: string;
    spaceId: string | null;
    lastPostedAt: Date | null;
  };
}

/**
 * Get forum posts after a certain ID (for incremental processing)
 */
export async function getForumPostsAfter(
  lastProcessedId: number,
  options?: {
    spaceId?: string;
    limit?: number;
  }
): Promise<ForumPost[]> {
  return prisma.forumPost.findMany({
    where: {
      discoursePostId: { gt: lastProcessedId },
      ...(options?.spaceId && { topic: { spaceId: options.spaceId } }),
    },
    include: {
      topic: {
        select: {
          title: true,
          slug: true,
          url: true,
          spaceId: true,
          lastPostedAt: true,
        },
      },
    },
    orderBy: { discoursePostId: 'asc' },
    take: options?.limit ?? 20,
  });
}

/**
 * Get recent posts by a specific author
 */
export async function getPostsByAuthor(
  authorUsername: string,
  options?: {
    limit?: number;
    since?: Date;
  }
): Promise<ForumPost[]> {
  return prisma.forumPost.findMany({
    where: {
      authorUsername: { equals: authorUsername, mode: 'insensitive' },
      ...(options?.since && { createdAt: { gte: options.since } }),
    },
    include: {
      topic: {
        select: {
          title: true,
          slug: true,
          url: true,
          spaceId: true,
          lastPostedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 20,
  });
}

/**
 * Get forum posts by discourse post IDs
 */
export async function getForumPostsByDiscourseIds(
  discoursePostIds: number[],
  options?: {
    spaceId?: string;
  }
): Promise<ForumPost[]> {
  if (discoursePostIds.length === 0) return [];
  return prisma.forumPost.findMany({
    where: {
      discoursePostId: { in: discoursePostIds },
      ...(options?.spaceId && { topic: { spaceId: options.spaceId } }),
    },
    include: {
      topic: {
        select: {
          title: true,
          slug: true,
          url: true,
          spaceId: true,
          lastPostedAt: true,
        },
      },
    },
    orderBy: { discoursePostId: 'asc' },
  });
}

/**
 * Search forum posts by content or topic title
 */
export async function searchForumPosts(
  query: string,
  options?: {
    spaceId?: string;
    limit?: number;
  }
): Promise<ForumPost[]> {
  const limit = options?.limit ?? 10;
  return prisma.forumPost.findMany({
    where: {
      ...(options?.spaceId && { topic: { spaceId: options.spaceId } }),
      OR: [
        { rawContent: { contains: query, mode: 'insensitive' } },
        { cookedContent: { contains: query, mode: 'insensitive' } },
        { topic: { title: { contains: query, mode: 'insensitive' } } },
      ],
    },
    include: {
      topic: {
        select: {
          title: true,
          slug: true,
          url: true,
          spaceId: true,
          lastPostedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// ============================================================================
// Protocol & Space Operations (Read-only)
// ============================================================================

export interface ProtocolInfo {
  id: string;
  slug: string;
  title: string;
  family: string | null;
  snapshotSpaceId: string | null;
  governanceSpace: {
    id: string;
    name: string;
    forumBaseUrl: string | null;
  } | null;
}

/**
 * Get protocol by slug or ID
 */
export async function getProtocol(slugOrId: string): Promise<ProtocolInfo | null> {
  return prisma.protocol.findFirst({
    where: {
      OR: [
        { id: slugOrId },
        { slug: slugOrId },
      ],
    },
    select: {
      id: true,
      slug: true,
      title: true,
      family: true,
      snapshotSpaceId: true,
      governanceSpace: {
        select: {
          id: true,
          name: true,
          forumBaseUrl: true,
        },
      },
    },
  });
}

/**
 * List all protocols with governance spaces
 */
export async function listProtocolsWithGovernance(): Promise<ProtocolInfo[]> {
  return prisma.protocol.findMany({
    where: {
      governanceSpace: { isNot: null },
    },
    select: {
      id: true,
      slug: true,
      title: true,
      family: true,
      snapshotSpaceId: true,
      governanceSpace: {
        select: {
          id: true,
          name: true,
          forumBaseUrl: true,
        },
      },
    },
    orderBy: { title: 'asc' },
  });
}

// ============================================================================
// Delegate / Token Holder Operations (Read-only)
// ============================================================================

export interface DelegateInfo {
  address: string;
  publicTag: string | null;
  publicTagCategory: string | null;
  hasActiveDelegations: boolean;
  aliases: Array<{ alias: string; aliasType: string }>;
}

/**
 * Get delegate info by address
 */
export async function getDelegate(address: string, spaceId: string): Promise<DelegateInfo | null> {
  return prisma.tokenHolder.findUnique({
    where: {
      address_spaceId: {
        address: address.toLowerCase(),
        spaceId,
      },
    },
    select: {
      address: true,
      publicTag: true,
      publicTagCategory: true,
      hasActiveDelegations: true,
      aliases: {
        select: {
          alias: true,
          aliasType: true,
        },
      },
    },
  });
}

// ============================================================================
// Task Queue Operations
// ============================================================================

export type TaskType =
  | 'FORUM_UPDATE'
  | 'REPO_ONBOARD'
  | 'GOVERNANCE_SUMMARY'
  | 'ENTITY_PROFILE'
  | 'PROTOCOL_DOCS';
export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface AgentTask {
  id: string;
  type: TaskType;
  protocolId: string | null;
  payload: unknown;
  status: TaskStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
}

/**
 * Get the next pending task (highest priority first)
 */
export async function getNextTask(): Promise<AgentTask | null> {
  return prisma.agentTask.findFirst({
    where: {
      status: 'PENDING',
      attempts: { lt: prisma.agentTask.fields.maxAttempts },
    },
    orderBy: [
      { priority: 'desc' },
      { createdAt: 'asc' },
    ],
  }) as Promise<AgentTask | null>;
}

/**
 * Create a new task
 */
export async function createTask(data: {
  type: TaskType;
  protocolId?: string;
  payload?: unknown;
  priority?: number;
}): Promise<AgentTask> {
  const payload = data.payload === undefined
    ? undefined
    : (data.payload as Prisma.InputJsonValue);

  return prisma.agentTask.create({
    data: {
      type: data.type,
      protocolId: data.protocolId ?? null,
      ...(payload !== undefined && { payload }),
      priority: data.priority ?? 0,
    },
  }) as Promise<AgentTask>;
}

/**
 * Update task status
 */
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  error?: string
): Promise<void> {
  await prisma.agentTask.update({
    where: { id: taskId },
    data: {
      status,
      ...(status === 'RUNNING' && { startedAt: new Date(), attempts: { increment: 1 } }),
      ...(status === 'COMPLETED' && { completedAt: new Date() }),
      ...(status === 'FAILED' && { lastError: error ?? null }),
    },
  });
}

// ============================================================================
// Execution Logging
// ============================================================================

/**
 * Log an execution attempt
 */
export async function logExecution(data: {
  taskId?: string;
  skillName: string;
  generatedCode?: string;
  success: boolean;
  errorMessage?: string;
  executionMs?: number;
}): Promise<void> {
  await prisma.agentExecutionLog.create({
    data: {
      taskId: data.taskId ?? null,
      skillName: data.skillName,
      generatedCode: data.generatedCode ?? null,
      success: data.success,
      errorMessage: data.errorMessage ?? null,
      executionMs: data.executionMs ?? null,
    },
  });
}
