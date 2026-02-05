/**
 * Output Tools for Loa Agent
 * 
 * Manages draft pages and markdown export for the documentation pipeline.
 * Drafts flow: Agent generates → Draft table → Review → Export to MD → Sync script
 */

import prisma from '../lib/prisma.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig } from '../lib/config.js';
import { notifyDiscord } from '../lib/notify.js';

// ============================================================================
// Types
// ============================================================================

export type DraftStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PUBLISHED';
export type DraftType = 'PAGE' | 'ENTITY_PROFILE';

export interface AgentDraft {
  id: string;
  protocolId: string;
  pagePath: string;
  title: string;
  content: string;
  draftType: DraftType;
  status: DraftStatus;
  sourceRefs: string[];
  reviewNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Draft CRUD Operations
// ============================================================================

/**
 * Save a draft page
 */
export async function saveDraft(
  protocolId: string,
  pagePath: string,
  data: {
    title: string;
    content: string;
    draftType?: DraftType;
    sourceRefs?: string[];
  }
): Promise<AgentDraft> {
  const existing = await prisma.agentDraft.findUnique({
    where: {
      protocolId_pagePath: {
        protocolId,
        pagePath,
      },
    },
    select: { id: true },
  });

  const draft = await prisma.agentDraft.upsert({
    where: {
      protocolId_pagePath: {
        protocolId,
        pagePath,
      },
    },
    create: {
      protocolId,
      pagePath,
      title: data.title,
      content: data.content,
      draftType: data.draftType ?? 'PAGE',
      sourceRefs: data.sourceRefs ?? [],
    },
    update: {
      title: data.title,
      content: data.content,
      draftType: data.draftType ?? 'PAGE',
      sourceRefs: data.sourceRefs ?? [],
      status: 'PENDING', // Reset to pending on update
      reviewNotes: null,
    },
  });

  if (!existing) {
    await notifyDiscord('draft_created', {
      title: 'New draft created',
      description: draft.title,
      fields: [
        { name: 'Protocol', value: protocolId, inline: true },
        { name: 'Path', value: pagePath, inline: true },
        { name: 'Type', value: draft.draftType, inline: true },
      ],
      color: 0x219ebc,
    });
  }

  return draft as AgentDraft;
}

/**
 * Get a draft by path
 */
export async function getDraft(
  protocolId: string,
  pagePath: string
): Promise<AgentDraft | null> {
  return prisma.agentDraft.findUnique({
    where: {
      protocolId_pagePath: {
        protocolId,
        pagePath,
      },
    },
  }) as Promise<AgentDraft | null>;
}

/**
 * List drafts for a protocol
 */
export async function listDrafts(
  protocolId: string,
  options?: {
    status?: DraftStatus;
    draftType?: DraftType;
    limit?: number;
  }
): Promise<AgentDraft[]> {
  return prisma.agentDraft.findMany({
    where: {
      protocolId,
      ...(options?.status && { status: options.status }),
      ...(options?.draftType && { draftType: options.draftType }),
    },
    orderBy: { updatedAt: 'desc' },
    take: options?.limit ?? 100,
  }) as Promise<AgentDraft[]>;
}

/**
 * Update draft status (for review workflow)
 */
export async function updateDraftStatus(
  protocolId: string,
  pagePath: string,
  status: DraftStatus,
  reviewNotes?: string
): Promise<AgentDraft | null> {
  try {
    const draft = await prisma.agentDraft.update({
      where: {
        protocolId_pagePath: {
          protocolId,
          pagePath,
        },
      },
      data: {
        status,
        reviewNotes: reviewNotes ?? null,
      },
    });
    return draft as AgentDraft;
  } catch {
    return null;
  }
}

/**
 * Approve a draft
 */
export async function approveDraft(
  protocolId: string,
  pagePath: string,
  notes?: string
): Promise<boolean> {
  const result = await updateDraftStatus(protocolId, pagePath, 'APPROVED', notes);
  return result !== null;
}

/**
 * Reject a draft
 */
export async function rejectDraft(
  protocolId: string,
  pagePath: string,
  reason: string
): Promise<boolean> {
  const result = await updateDraftStatus(protocolId, pagePath, 'REJECTED', reason);
  return result !== null;
}

// ============================================================================
// Markdown Export
// ============================================================================

/**
 * Generate frontmatter for a markdown file
 */
function generateFrontmatter(draft: AgentDraft): string {
  return `---
title: "${draft.title}"
path: "${draft.pagePath}"
generated: true
generatedAt: "${draft.updatedAt.toISOString()}"
sourceRefs: ${JSON.stringify(draft.sourceRefs)}
---

`;
}

/**
 * Export a single draft to markdown
 */
export async function exportDraftToMarkdown(
  protocolId: string,
  pagePath: string,
  outputDir: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const draft = await getDraft(protocolId, pagePath);
  
  if (!draft) {
    return { success: false, error: 'Draft not found' };
  }
  
  if (draft.status !== 'APPROVED') {
    return { success: false, error: `Draft status is ${draft.status}, must be APPROVED` };
  }
  
  try {
    // Create directory structure based on pagePath
    const filePath = path.join(outputDir, `${pagePath}.md`);
    const dirPath = path.dirname(filePath);
    
    await fs.mkdir(dirPath, { recursive: true });
    
    // Write markdown with frontmatter
    const content = generateFrontmatter(draft) + draft.content;
    await fs.writeFile(filePath, content, 'utf-8');
    
    // Mark as published
    await updateDraftStatus(protocolId, pagePath, 'PUBLISHED');
    
    return { success: true, filePath };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Export all approved drafts for a protocol
 */
export async function exportAllApprovedDrafts(
  protocolId: string,
  outputDir: string
): Promise<{
  exported: number;
  failed: number;
  results: Array<{ pagePath: string; success: boolean; error?: string }>;
}> {
  const drafts = await listDrafts(protocolId, { status: 'APPROVED' });
  
  const results: Array<{ pagePath: string; success: boolean; error?: string }> = [];
  let exported = 0;
  let failed = 0;
  
  for (const draft of drafts) {
    const result = await exportDraftToMarkdown(protocolId, draft.pagePath, outputDir);
    results.push({ pagePath: draft.pagePath, ...result });
    
    if (result.success) {
      exported++;
    } else {
      failed++;
    }
  }
  
  return { exported, failed, results };
}

// ============================================================================
// Source Document Operations
// ============================================================================

export type SourceDocType = 'OFFICIAL_DOCS' | 'README' | 'WHITEPAPER' | 'GITHUB_WIKI';

export interface ProtocolSourceDoc {
  id: string;
  protocolId: string;
  sourceType: SourceDocType;
  sourceUrl: string | null;
  title: string;
  content: string;
  section: string | null;
  fetchedAt: Date;
  createdAt: Date;
}

/**
 * Get source documents for a protocol
 */
export async function getSourceDocs(
  protocolId: string,
  options?: {
    sourceType?: SourceDocType;
    section?: string;
    limit?: number;
  }
): Promise<ProtocolSourceDoc[]> {
  return prisma.protocolSourceDoc.findMany({
    where: {
      protocolId,
      ...(options?.sourceType && { sourceType: options.sourceType }),
      ...(options?.section && { section: { startsWith: options.section } }),
    },
    orderBy: { section: 'asc' },
    take: options?.limit ?? 100,
  }) as Promise<ProtocolSourceDoc[]>;
}

/**
 * Get a specific source document by section
 */
export async function getSourceDocBySection(
  protocolId: string,
  section: string
): Promise<ProtocolSourceDoc | null> {
  return prisma.protocolSourceDoc.findFirst({
    where: {
      protocolId,
      section,
    },
  }) as Promise<ProtocolSourceDoc | null>;
}

/**
 * Upsert a source document
 */
export async function upsertSourceDoc(
  protocolId: string,
  data: {
    sourceType: SourceDocType;
    title: string;
    content: string;
    section?: string;
    sourceUrl?: string;
  }
): Promise<ProtocolSourceDoc> {
  const section = data.section ?? data.title.toLowerCase().replace(/\s+/g, '-');
  
  // Use section as unique identifier within protocol+type
  const existing = await prisma.protocolSourceDoc.findFirst({
    where: {
      protocolId,
      sourceType: data.sourceType,
      section,
    },
  });
  
  if (existing) {
    return prisma.protocolSourceDoc.update({
      where: { id: existing.id },
      data: {
        title: data.title,
        content: data.content,
        sourceUrl: data.sourceUrl ?? null,
        fetchedAt: new Date(),
      },
    }) as Promise<ProtocolSourceDoc>;
  }
  
  return prisma.protocolSourceDoc.create({
    data: {
      protocolId,
      sourceType: data.sourceType,
      title: data.title,
      content: data.content,
      section,
      sourceUrl: data.sourceUrl ?? null,
      fetchedAt: new Date(),
    },
  }) as Promise<ProtocolSourceDoc>;
}

// ============================================================================
// Draft Statistics
// ============================================================================

/**
 * Get draft statistics for a protocol
 */
export async function getDraftStats(protocolId: string): Promise<{
  pending: number;
  approved: number;
  rejected: number;
  published: number;
  total: number;
}> {
  const counts = await prisma.agentDraft.groupBy({
    by: ['status'],
    where: { protocolId },
    _count: true,
  });
  
  const stats = {
    pending: 0,
    approved: 0,
    rejected: 0,
    published: 0,
    total: 0,
  };
  
  for (const count of counts) {
    const key = count.status.toLowerCase() as keyof typeof stats;
    if (key in stats) {
      stats[key] = count._count;
      stats.total += count._count;
    }
  }
  
  return stats;
}





