import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { getConfig } from './config.js';

export interface MemoryFact {
  id: string;
  fact: string;
  category: string;
  timestamp: string;
  source: string;
  status: 'active' | 'superseded';
  supersededBy: string | null;
  relatedEntities: string[];
  lastAccessed: string | null;
  accessCount: number;
}

const MEMORY_PROJECTS_DIR = 'projects';

function getMemoryRoot(): string {
  return getConfig().AGENT_MEMORY_ROOT;
}

function hashFact(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function getProjectDir(slug: string): string {
  return path.join(getMemoryRoot(), MEMORY_PROJECTS_DIR, slug);
}

export async function readProtocolSummary(slug: string): Promise<string | null> {
  const filePath = path.join(getProjectDir(slug), 'summary.md');
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function writeProtocolSummary(slug: string, summary: string): Promise<void> {
  const dirPath = getProjectDir(slug);
  await ensureDir(dirPath);
  const filePath = path.join(dirPath, 'summary.md');
  await fs.writeFile(filePath, summary, 'utf-8');
}

async function readFacts(slug: string): Promise<MemoryFact[]> {
  const filePath = path.join(getProjectDir(slug), 'items.json');
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as MemoryFact[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFacts(slug: string, facts: MemoryFact[]): Promise<void> {
  const dirPath = getProjectDir(slug);
  await ensureDir(dirPath);
  const filePath = path.join(dirPath, 'items.json');
  await fs.writeFile(filePath, JSON.stringify(facts, null, 2), 'utf-8');
}

export async function upsertFact(params: {
  slug: string;
  category: string;
  fact: string;
  source: string;
  timestamp: string;
  relatedEntities?: string[];
}): Promise<void> {
  const { slug, category, fact, source, timestamp, relatedEntities } = params;
  const existing = await readFacts(slug);
  const candidateId = `${category}-${hashFact(fact)}`;

  const alreadyExists = existing.some((item) => item.id === candidateId && item.status === 'active');
  if (alreadyExists) return;

  const updated = existing.map((item) => {
    if (item.category === category && item.status === 'active') {
      return {
        ...item,
        status: 'superseded' as const,
        supersededBy: candidateId,
      };
    }
    return item;
  });

  updated.push({
    id: candidateId,
    fact,
    category,
    timestamp,
    source,
    status: 'active',
    supersededBy: null,
    relatedEntities: relatedEntities ?? [],
    lastAccessed: null,
    accessCount: 0,
  });

  await writeFacts(slug, updated);
}
