import { callGeminiWithSkill } from '../lib/gemini.js';
import { getConfig } from '../lib/config.js';
import { createLogger } from '../lib/logger.js';
import { PromptStore, PromptSectionInput } from './promptStore.js';
import { RlmAction, RlmActionType, RlmRunOptions, RlmRunResult, RlmToolResult, RlmTraceStep } from './types.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as db from '../tools/db.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

// Simple fetch wrapper for the tool
async function fetchUrl(url: string): Promise<string> {
  // Use a dynamic import or global fetch if available (Node 18+)
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

const log = createLogger('RLM');
const execFileAsync = promisify(execFile);

const BASE_ACTIONS: RlmActionType[] = [
  'list_sections',
  'list_chunks',
  'read_section',
  'read_chunk',
  'read_range',
  'search',
  'recurse',
  'final',
  'web_fetch',
  'fs_list',
  'fs_read',
  'qmd_search',
  'qmd_vsearch',
  'qmd_query',
  'qmd_get',
  'qmd_multi_get',
  'qmd_status',
];

const DB_ACTIONS: RlmActionType[] = [
  'db_search_posts',
  'db_get_posts',
  'db_get_posts_by_author',
  'db_get_posts_after',
];

const ALL_ACTIONS: RlmActionType[] = [...BASE_ACTIONS, ...DB_ACTIONS];

const PREVIEW_CHARS = 280;

type ResolvedOptions = Omit<Required<RlmRunOptions>, 'dbScope' | 'fsScope'> & {
  dbScope?: RlmRunOptions['dbScope'];
  fsScope?: RlmRunOptions['fsScope'];
  qmdBin: string;
  qmdIndex?: string;
};

function resolveOptions(options?: RlmRunOptions): ResolvedOptions {
  const config = getConfig();
  return {
    model: options?.model ?? config.GEMINI_MODEL,
    skillName: options?.skillName ?? 'recursive-tools',
    maxSteps: options?.maxSteps ?? 24,
    maxDepth: options?.maxDepth ?? 3,
    maxReadBytes: options?.maxReadBytes ?? 20000,
    maxSectionBytes: options?.maxSectionBytes ?? 80000,
    maxSearchResults: options?.maxSearchResults ?? 8,
    maxToolResultChars: options?.maxToolResultChars ?? 4000,
    chunkBytes: options?.chunkBytes ?? 8000,
    workspaceDir: options?.workspaceDir ?? path.join(config.AGENT_WORKSPACE, 'rlm'),
    workingDir: options?.workingDir ?? process.cwd(),
    stepTimeoutMs: options?.stepTimeoutMs ?? 120000,
    dbScope: options?.dbScope,
    fsScope: options?.fsScope,
    qmdBin: config.QMD_BIN,
    qmdIndex: config.QMD_INDEX,
  };
}

function truncateForPrompt(value: unknown, maxChars: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length <= maxChars) return value;
    return value.slice(0, maxChars) + '...[truncated]';
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxChars) return value;
    return serialized.slice(0, maxChars) + '...[truncated]';
  } catch {
    const fallback = String(value);
    return fallback.length <= maxChars ? fallback : fallback.slice(0, maxChars) + '...[truncated]';
  }
}

function parseAction(raw: string): RlmAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON action: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Action response must be a JSON object');
  }
  const action = parsed as RlmAction;
  if (!action.action || typeof action.action !== 'string') {
    throw new Error('Action response missing "action"');
  }
  if (!ALL_ACTIONS.includes(action.action)) {
    throw new Error(`Unsupported action: ${action.action}`);
  }
  return action;
}

function getAllowedActions(options: ResolvedOptions): RlmActionType[] {
  if (!options.dbScope) return BASE_ACTIONS;
  return [...BASE_ACTIONS, ...DB_ACTIONS];
}

function buildStepContext(params: {
  task: string;
  expectedOutput?: string;
  depth: number;
  step: number;
  store: PromptStore;
  options: ResolvedOptions;
  trace: RlmTraceStep[];
  lastToolResult?: RlmToolResult;
}): Record<string, unknown> {
  const { task, expectedOutput, depth, step, store, options, trace, lastToolResult } = params;
  const toolResultPreview = lastToolResult
    ? {
        tool: lastToolResult.tool,
        ok: lastToolResult.ok,
        summary: lastToolResult.summary,
        dataPreview: truncateForPrompt(lastToolResult.data, options.maxToolResultChars),
        truncated: lastToolResult.truncated ?? false,
      }
    : null;

  return {
    task,
    expectedOutput: expectedOutput ?? 'Return the final answer as JSON in the "result" field.',
    depth,
    step,
    limits: {
      maxSteps: options.maxSteps,
      maxDepth: options.maxDepth,
      maxReadBytes: options.maxReadBytes,
      maxSectionBytes: options.maxSectionBytes,
      maxSearchResults: options.maxSearchResults,
      maxToolResultChars: options.maxToolResultChars,
    },
    promptMeta: store.getMeta(),
    allowedActions: getAllowedActions(options),
    dbScope: options.dbScope ?? null,
    fsScope: options.fsScope ? { rootDir: options.fsScope.rootDir } : null,
    lastToolResult: toolResultPreview,
    recentSteps: trace.slice(-3),
  };
}

async function buildSubStoreFromSections(
  store: PromptStore,
  sectionIds: string[],
  options: ResolvedOptions
): Promise<{ store: PromptStore; truncated: boolean; sectionCount: number }> {
  const sections: PromptSectionInput[] = [];
  let truncated = false;
  for (const id of sectionIds) {
    const { section, text, truncated: sectionTruncated } = await store.getSection(id, options.maxSectionBytes);
    sections.push({
      id: section.id,
      label: section.label,
      content: text,
      meta: section.meta,
    });
    if (sectionTruncated) truncated = true;
  }
  if (sections.length === 0) {
    throw new Error('No sections resolved for recursion');
  }
  const subStore = await PromptStore.fromSections('RLM subtask', sections, {
    chunkBytes: options.chunkBytes,
    workspaceDir: options.workspaceDir,
  });
  return { store: subStore, truncated, sectionCount: sections.length };
}

async function buildSubStoreFromChunks(
  store: PromptStore,
  chunkIds: number[],
  options: ResolvedOptions
): Promise<{ store: PromptStore; sectionCount: number }> {
  const sections: PromptSectionInput[] = [];
  for (const id of chunkIds) {
    const { chunk, text } = await store.getChunk(id);
    sections.push({
      id: `chunk-${chunk.id}`,
      label: `chunk ${chunk.id}`,
      content: text,
      meta: { start: chunk.start, end: chunk.end },
    });
  }
  if (sections.length === 0) {
    throw new Error('No chunks resolved for recursion');
  }
  const subStore = await PromptStore.fromSections('RLM subtask', sections, {
    chunkBytes: options.chunkBytes,
    workspaceDir: options.workspaceDir,
  });
  return { store: subStore, sectionCount: sections.length };
}

async function buildSubStoreFromRange(
  store: PromptStore,
  start: number,
  end: number,
  options: ResolvedOptions
): Promise<{ store: PromptStore; truncated: boolean }> {
  let truncated = false;
  let effectiveEnd = end;
  if (end - start > options.maxSectionBytes) {
    effectiveEnd = start + options.maxSectionBytes;
    truncated = true;
  }
  const { text } = await store.getRange(start, effectiveEnd);
  const subStore = await PromptStore.fromText(text, {
    chunkBytes: options.chunkBytes,
    workspaceDir: options.workspaceDir,
  });
  return { store: subStore, truncated };
}

function getPostText(post: db.ForumPost): string {
  return (post.rawContent || post.cookedContent || '').trim();
}

function truncateTextByBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) {
    return { text, truncated: false };
  }
  return { text: buffer.slice(0, maxBytes).toString('utf8'), truncated: true };
}

function formatPostPreview(post: db.ForumPost): Record<string, unknown> {
  const content = getPostText(post);
  const preview = content.length > PREVIEW_CHARS ? `${content.slice(0, PREVIEW_CHARS)}...` : content;
  return {
    id: post.id,
    discoursePostId: post.discoursePostId,
    authorUsername: post.authorUsername,
    authorDisplayName: post.authorDisplayName,
    createdAt: post.createdAt,
    likeCount: post.likeCount,
    topic: post.topic,
    contentPreview: preview,
  };
}

function formatPostFull(post: db.ForumPost, maxBytes: number): { data: Record<string, unknown>; truncated: boolean } {
  const content = getPostText(post);
  const truncated = truncateTextByBytes(content, maxBytes);
  return {
    data: {
      id: post.id,
      discoursePostId: post.discoursePostId,
      authorUsername: post.authorUsername,
      authorDisplayName: post.authorDisplayName,
      createdAt: post.createdAt,
      likeCount: post.likeCount,
      topic: post.topic,
      content: truncated.text,
    },
    truncated: truncated.truncated,
  };
}

function getDbScope(options: ResolvedOptions, toolInput: Record<string, unknown>): { spaceId?: string; lastProcessedPostId?: number } | null {
  if (!options.dbScope) return null;
  const scope = options.dbScope;
  const requestedSpaceId = typeof toolInput.spaceId === 'string' ? toolInput.spaceId : undefined;
  if (requestedSpaceId && scope.spaceId && requestedSpaceId !== scope.spaceId) {
    return null;
  }
  return {
    spaceId: scope.spaceId ?? requestedSpaceId,
    lastProcessedPostId: scope.lastProcessedPostId,
  };
}

async function executeAction(params: {
  action: RlmAction;
  store: PromptStore;
  options: ResolvedOptions;
  depth: number;
  task: string;
  expectedOutput?: string;
}): Promise<{ done?: boolean; result?: unknown; toolResult?: RlmToolResult }> {
  const { action, store, options, depth, task, expectedOutput } = params;
  const toolInput = action.toolInput ?? {};
  const qmdBaseArgs = options.qmdIndex ? ['--index', options.qmdIndex] : [];

  if (action.action === 'final') {
    if (action.result === undefined) {
      return {
        toolResult: {
          tool: 'final',
          ok: false,
          summary: 'Final action missing result',
          error: 'Final action missing result',
        },
      };
    }
    return { done: true, result: action.result };
  }

  if (action.action === 'list_sections') {
    const limit = typeof toolInput.limit === 'number' ? toolInput.limit : options.maxSearchResults;
    const offset = typeof toolInput.offset === 'number' ? toolInput.offset : 0;
    const sections = store.listSections(limit, offset);
    return {
      toolResult: {
        tool: 'list_sections',
        ok: true,
        summary: `Listed ${sections.length} sections`,
        data: sections,
      },
    };
  }

  if (action.action === 'list_chunks') {
    const limit = typeof toolInput.limit === 'number' ? toolInput.limit : options.maxSearchResults;
    const offset = typeof toolInput.offset === 'number' ? toolInput.offset : 0;
    const chunks = store.listChunks(limit, offset);
    return {
      toolResult: {
        tool: 'list_chunks',
        ok: true,
        summary: `Listed ${chunks.length} chunks`,
        data: chunks,
      },
    };
  }

  if (action.action === 'read_section') {
    const id = typeof toolInput.id === 'string' ? toolInput.id : '';
    if (!id) {
      return {
        toolResult: {
          tool: 'read_section',
          ok: false,
          summary: 'read_section requires an id',
          error: 'Missing id',
        },
      };
    }
    const result = await store.getSection(id, options.maxSectionBytes);
    return {
      toolResult: {
        tool: 'read_section',
        ok: true,
        summary: `Read section ${id}${result.truncated ? ' (truncated)' : ''}`,
        data: {
          section: result.section,
          text: result.text,
        },
        truncated: result.truncated,
      },
    };
  }

  if (action.action === 'read_chunk') {
    const id = typeof toolInput.id === 'number' ? toolInput.id : Number(toolInput.id);
    if (Number.isNaN(id)) {
      return {
        toolResult: {
          tool: 'read_chunk',
          ok: false,
          summary: 'read_chunk requires a numeric id',
          error: 'Missing id',
        },
      };
    }
    const result = await store.getChunk(id);
    return {
      toolResult: {
        tool: 'read_chunk',
        ok: true,
        summary: `Read chunk ${id}`,
        data: {
          chunk: result.chunk,
          text: result.text,
        },
      },
    };
  }

  if (action.action === 'read_range') {
    const start = typeof toolInput.start === 'number' ? toolInput.start : Number(toolInput.start);
    let end = typeof toolInput.end === 'number' ? toolInput.end : Number(toolInput.end);
    const length = typeof toolInput.length === 'number' ? toolInput.length : Number(toolInput.length);
    if (!Number.isFinite(start)) {
      return {
        toolResult: {
          tool: 'read_range',
          ok: false,
          summary: 'read_range requires start',
          error: 'Missing start',
        },
      };
    }
    if (!Number.isFinite(end) && Number.isFinite(length)) {
      end = start + length;
    }
    if (!Number.isFinite(end)) {
      return {
        toolResult: {
          tool: 'read_range',
          ok: false,
          summary: 'read_range requires end or length',
          error: 'Missing end/length',
        },
      };
    }
    let truncated = false;
    if (end - start > options.maxReadBytes) {
      end = start + options.maxReadBytes;
      truncated = true;
    }
    const result = await store.getRange(start, end);
    return {
      toolResult: {
        tool: 'read_range',
        ok: true,
        summary: `Read range ${result.start}-${result.end}${truncated ? ' (truncated)' : ''}`,
        data: result,
        truncated,
      },
    };
  }

  if (action.action === 'search') {
    const query = typeof toolInput.query === 'string' ? toolInput.query : '';
    if (!query) {
      return {
        toolResult: {
          tool: 'search',
          ok: false,
          summary: 'search requires a query',
          error: 'Missing query',
        },
      };
    }
    const caseSensitive = toolInput.caseSensitive === true;
    const limit = typeof toolInput.limit === 'number' ? toolInput.limit : options.maxSearchResults;
    const matches = await store.search(query, { limit, caseSensitive });
    return {
      toolResult: {
        tool: 'search',
        ok: true,
        summary: `Search "${query}" returned ${matches.length} matches`,
        data: matches,
      },
    };
  }

  if (action.action === 'web_fetch') {
    const url = typeof toolInput.url === 'string' ? toolInput.url : '';
    if (!url || !url.startsWith('http')) {
      return {
        toolResult: {
          tool: 'web_fetch',
          ok: false,
          summary: 'Invalid or missing URL',
          error: 'Invalid or missing URL',
        },
      };
    }
    try {
      const text = await fetchUrl(url);
      const truncated = truncateTextByBytes(text, options.maxReadBytes);
      return {
        toolResult: {
          tool: 'web_fetch',
          ok: true,
          summary: `Fetched ${url}`,
          data: { content: truncated.text },
          truncated: truncated.truncated,
        },
      };
    } catch (err) {
      return {
        toolResult: {
          tool: 'web_fetch',
          ok: false,
          summary: `Failed to fetch ${url}`,
          error: (err as Error).message,
        },
      };
    }
  }

  if (action.action === 'fs_list') {
    const dirPath = typeof toolInput.path === 'string' ? toolInput.path : '.';
    if (!options.fsScope) {
      return {
        toolResult: { tool: 'fs_list', ok: false, summary: 'FS access denied', error: 'No fsScope configured' },
      };
    }
    try {
      // Security check: ensure path is within rootDir
      const resolvedPath = path.resolve(options.fsScope.rootDir, dirPath);
      if (!resolvedPath.startsWith(path.resolve(options.fsScope.rootDir))) {
         return {
          toolResult: { tool: 'fs_list', ok: false, summary: 'Access denied', error: 'Path outside rootDir' },
        };
      }
      const files = await fs.readdir(resolvedPath, { withFileTypes: true });
      const listing = files.map(f => ({
        name: f.name,
        isDirectory: f.isDirectory(),
        path: path.relative(options.fsScope!.rootDir, path.join(resolvedPath, f.name))
      })).slice(0, options.maxSearchResults);
      
      return {
        toolResult: {
          tool: 'fs_list',
          ok: true,
          summary: `Listed ${listing.length} items in ${dirPath}`,
          data: listing,
        },
      };
    } catch (err) {
      return {
        toolResult: { tool: 'fs_list', ok: false, summary: 'List failed', error: (err as Error).message },
      };
    }
  }

  if (action.action === 'fs_read') {
    const filePath = typeof toolInput.path === 'string' ? toolInput.path : '';
    if (!options.fsScope) {
      return {
        toolResult: { tool: 'fs_read', ok: false, summary: 'FS access denied', error: 'No fsScope configured' },
      };
    }
    try {
      const resolvedPath = path.resolve(options.fsScope.rootDir, filePath);
      if (!resolvedPath.startsWith(path.resolve(options.fsScope.rootDir))) {
         return {
          toolResult: { tool: 'fs_read', ok: false, summary: 'Access denied', error: 'Path outside rootDir' },
        };
      }
      const content = await fs.readFile(resolvedPath, 'utf8');
      const truncated = truncateTextByBytes(content, options.maxReadBytes);
      return {
        toolResult: {
          tool: 'fs_read',
          ok: true,
          summary: `Read ${filePath}`,
          data: { content: truncated.text },
          truncated: truncated.truncated,
        },
      };
    } catch (err) {
       return {
        toolResult: { tool: 'fs_read', ok: false, summary: 'Read failed', error: (err as Error).message },
      };
    }
  }

  if (action.action === 'qmd_status') {
    try {
      const { stdout } = await execFileAsync(options.qmdBin, [...qmdBaseArgs, 'status'], {
        cwd: options.workingDir,
      });
      return {
        toolResult: {
          tool: 'qmd_status',
          ok: true,
          summary: 'QMD status retrieved',
          data: { output: stdout.trim() },
        },
      };
    } catch (err) {
      return {
        toolResult: {
          tool: 'qmd_status',
          ok: false,
          summary: 'QMD status failed',
          error: (err as Error).message,
        },
      };
    }
  }

  if (action.action === 'qmd_search' || action.action === 'qmd_vsearch' || action.action === 'qmd_query') {
    const query = typeof toolInput.query === 'string' ? toolInput.query : '';
    if (!query) {
      return {
        toolResult: {
          tool: action.action,
          ok: false,
          summary: `${action.action} requires query`,
          error: 'Missing query',
        },
      };
    }
    const limit = typeof toolInput.limit === 'number' ? toolInput.limit : options.maxSearchResults;
    const collection = typeof toolInput.collection === 'string' ? toolInput.collection : undefined;
    const minScore = typeof toolInput.minScore === 'number' ? toolInput.minScore : undefined;
    const command = action.action === 'qmd_search'
      ? 'search'
      : action.action === 'qmd_vsearch'
        ? 'vsearch'
        : 'query';
    const args = [
      ...qmdBaseArgs,
      command,
      query,
      '--json',
      '-n',
      String(limit),
    ];
    if (collection) args.push('-c', collection);
    if (minScore !== undefined) args.push('--min-score', String(minScore));
    try {
      const { stdout } = await execFileAsync(options.qmdBin, args, { cwd: options.workingDir });
      return {
        toolResult: {
          tool: action.action,
          ok: true,
          summary: `QMD ${command} returned results`,
          data: { output: stdout.trim() },
        },
      };
    } catch (err) {
      return {
        toolResult: {
          tool: action.action,
          ok: false,
          summary: `QMD ${command} failed`,
          error: (err as Error).message,
        },
      };
    }
  }

  if (action.action === 'qmd_get') {
    const doc = typeof toolInput.doc === 'string' ? toolInput.doc : '';
    if (!doc) {
      return {
        toolResult: {
          tool: 'qmd_get',
          ok: false,
          summary: 'qmd_get requires doc',
          error: 'Missing doc',
        },
      };
    }
    const full = toolInput.full === true;
    const args = [...qmdBaseArgs, 'get', doc];
    if (full) args.push('--full');
    try {
      const { stdout } = await execFileAsync(options.qmdBin, args, { cwd: options.workingDir });
      return {
        toolResult: {
          tool: 'qmd_get',
          ok: true,
          summary: `QMD get ${doc}`,
          data: { output: stdout.trim() },
        },
      };
    } catch (err) {
      return {
        toolResult: {
          tool: 'qmd_get',
          ok: false,
          summary: 'QMD get failed',
          error: (err as Error).message,
        },
      };
    }
  }

  if (action.action === 'qmd_multi_get') {
    const docs = Array.isArray(toolInput.docs) ? toolInput.docs.map(String) : [];
    if (docs.length === 0) {
      return {
        toolResult: {
          tool: 'qmd_multi_get',
          ok: false,
          summary: 'qmd_multi_get requires docs',
          error: 'Missing docs',
        },
      };
    }
    const args = [...qmdBaseArgs, 'multi-get', docs.join(',') , '--json'];
    try {
      const { stdout } = await execFileAsync(options.qmdBin, args, { cwd: options.workingDir });
      return {
        toolResult: {
          tool: 'qmd_multi_get',
          ok: true,
          summary: `QMD multi-get ${docs.length} docs`,
          data: { output: stdout.trim() },
        },
      };
    } catch (err) {
      return {
        toolResult: {
          tool: 'qmd_multi_get',
          ok: false,
          summary: 'QMD multi-get failed',
          error: (err as Error).message,
        },
      };
    }
  }

  if (action.action === 'db_search_posts') {
    const query = typeof toolInput.query === 'string' ? toolInput.query : '';
    if (!query) {
      return {
        toolResult: {
          tool: 'db_search_posts',
          ok: false,
          summary: 'db_search_posts requires a query',
          error: 'Missing query',
        },
      };
    }
    const scope = getDbScope(options, toolInput);
    if (!scope?.spaceId) {
      return {
        toolResult: {
          tool: 'db_search_posts',
          ok: false,
          summary: 'db_search_posts requires a spaceId scope',
          error: 'Missing db scope',
        },
      };
    }
    const limit = typeof toolInput.limit === 'number' ? toolInput.limit : options.maxSearchResults;
    const posts = await db.searchForumPosts(query, {
      spaceId: scope.spaceId,
      limit: Math.min(limit, options.maxSearchResults),
    });
    return {
      toolResult: {
        tool: 'db_search_posts',
        ok: true,
        summary: `Found ${posts.length} posts matching "${query}"`,
        data: posts.map(formatPostPreview),
      },
    };
  }

  if (action.action === 'db_get_posts') {
    const idsInput = Array.isArray(toolInput.discoursePostIds) ? toolInput.discoursePostIds : [];
    const ids = idsInput
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (ids.length === 0) {
      return {
        toolResult: {
          tool: 'db_get_posts',
          ok: false,
          summary: 'db_get_posts requires discoursePostIds',
          error: 'Missing discoursePostIds',
        },
      };
    }
    const scope = getDbScope(options, toolInput);
    if (!scope?.spaceId) {
      return {
        toolResult: {
          tool: 'db_get_posts',
          ok: false,
          summary: 'db_get_posts requires a spaceId scope',
          error: 'Missing db scope',
        },
      };
    }
    const limitedIds = ids.slice(0, options.maxSearchResults);
    const posts = await db.getForumPostsByDiscourseIds(limitedIds, { spaceId: scope.spaceId });
    let truncated = false;
    const data = posts.map((post) => {
      const formatted = formatPostFull(post, options.maxReadBytes);
      if (formatted.truncated) truncated = true;
      return formatted.data;
    });
    return {
      toolResult: {
        tool: 'db_get_posts',
        ok: true,
        summary: `Loaded ${posts.length} posts`,
        data,
        truncated,
      },
    };
  }

  if (action.action === 'db_get_posts_by_author') {
    const authorUsername = typeof toolInput.authorUsername === 'string' ? toolInput.authorUsername : '';
    if (!authorUsername) {
      return {
        toolResult: {
          tool: 'db_get_posts_by_author',
          ok: false,
          summary: 'db_get_posts_by_author requires authorUsername',
          error: 'Missing authorUsername',
        },
      };
    }
    const scope = getDbScope(options, toolInput);
    if (!scope?.spaceId) {
      return {
        toolResult: {
          tool: 'db_get_posts_by_author',
          ok: false,
          summary: 'db_get_posts_by_author requires a spaceId scope',
          error: 'Missing db scope',
        },
      };
    }
    const limit = typeof toolInput.limit === 'number' ? toolInput.limit : options.maxSearchResults;
    const posts = await db.getPostsByAuthor(authorUsername, { limit: Math.min(limit, options.maxSearchResults) });
    const filtered = posts.filter((post) => post.topic.spaceId === scope.spaceId);
    return {
      toolResult: {
        tool: 'db_get_posts_by_author',
        ok: true,
        summary: `Loaded ${filtered.length} posts by ${authorUsername}`,
        data: filtered.map(formatPostPreview),
      },
    };
  }

  if (action.action === 'db_get_posts_after') {
    const scope = getDbScope(options, toolInput);
    if (!scope?.spaceId) {
      return {
        toolResult: {
          tool: 'db_get_posts_after',
          ok: false,
          summary: 'db_get_posts_after requires a spaceId scope',
          error: 'Missing db scope',
        },
      };
    }
    const afterId = Number.isFinite(Number(toolInput.afterId))
      ? Number(toolInput.afterId)
      : scope.lastProcessedPostId ?? 0;
    const limit = typeof toolInput.limit === 'number' ? toolInput.limit : options.maxSearchResults;
    const posts = await db.getForumPostsAfter(afterId, {
      spaceId: scope.spaceId,
      limit: Math.min(limit, options.maxSearchResults),
    });
    return {
      toolResult: {
        tool: 'db_get_posts_after',
        ok: true,
        summary: `Loaded ${posts.length} posts after ${afterId}`,
        data: posts.map(formatPostPreview),
      },
    };
  }

  if (action.action === 'recurse') {
    if (depth + 1 > options.maxDepth) {
      return {
        toolResult: {
          tool: 'recurse',
          ok: false,
          summary: 'Max recursion depth reached',
          error: 'Max recursion depth reached',
        },
      };
    }
    const subtask = typeof toolInput.subtask === 'string' ? toolInput.subtask : task;
    const subExpected = typeof toolInput.expectedOutput === 'string' ? toolInput.expectedOutput : expectedOutput;
    const scope = typeof toolInput.scope === 'object' && toolInput.scope ? toolInput.scope : toolInput;
    const sectionIds = Array.isArray((scope as Record<string, unknown>).sectionIds)
      ? (scope as Record<string, unknown>).sectionIds as Array<string | number>
      : null;
    const chunkIds = Array.isArray((scope as Record<string, unknown>).chunkIds)
      ? (scope as Record<string, unknown>).chunkIds as Array<string | number>
      : null;
    const range = (scope as Record<string, unknown>).range as Record<string, unknown> | undefined;

    let subStore: PromptStore;
    let summaryDetail = '';
    let truncated = false;

    if (sectionIds && sectionIds.length > 0) {
      const ids = sectionIds.map((value) => String(value));
      const built = await buildSubStoreFromSections(store, ids, options);
      subStore = built.store;
      truncated = built.truncated;
      summaryDetail = `sections ${ids.join(', ')}`;
    } else if (chunkIds && chunkIds.length > 0) {
      const ids = chunkIds.map((value) => Number(value)).filter((value) => Number.isFinite(value));
      const built = await buildSubStoreFromChunks(store, ids, options);
      subStore = built.store;
      summaryDetail = `chunks ${ids.join(', ')}`;
    } else if (range && typeof range.start === 'number' && typeof range.end === 'number') {
      const built = await buildSubStoreFromRange(store, range.start, range.end, options);
      subStore = built.store;
      truncated = built.truncated;
      summaryDetail = `range ${range.start}-${range.end}`;
    } else {
      return {
        toolResult: {
          tool: 'recurse',
          ok: false,
          summary: 'recurse requires scope.sectionIds, scope.chunkIds, or scope.range',
          error: 'Missing scope',
        },
      };
    }

    const subResult = await runRlm({
      store: subStore,
      task: subtask,
      expectedOutput: subExpected,
      options,
      depth: depth + 1,
    });

    return {
      toolResult: {
        tool: 'recurse',
        ok: subResult.ok,
        summary: `Recurse on ${summaryDetail}${truncated ? ' (truncated)' : ''}`,
        data: subResult.ok ? subResult.result : { error: subResult.error },
        truncated,
        error: subResult.ok ? undefined : subResult.error,
      },
    };
  }

  return {
    toolResult: {
      tool: action.action,
      ok: false,
      summary: `Unsupported action: ${action.action}`,
      error: `Unsupported action: ${action.action}`,
    },
  };
}

export async function runRlm(params: {
  store: PromptStore;
  task: string;
  expectedOutput?: string;
  options?: RlmRunOptions;
  depth?: number;
}): Promise<RlmRunResult> {
  const { store, task, expectedOutput } = params;
  const depth = params.depth ?? 0;
  const options = resolveOptions(params.options);
  const trace: RlmTraceStep[] = [];
  let lastToolResult: RlmToolResult | undefined;

  for (let step = 1; step <= options.maxSteps; step++) {
    const context = buildStepContext({
      task,
      expectedOutput,
      depth,
      step,
      store,
      options,
      trace,
      lastToolResult,
    });

    log.debug(`RLM step ${step} (depth ${depth})`);

    const response = await callGeminiWithSkill(
      options.skillName,
      'Choose the next recursive tool action.',
      context,
      {
        model: options.model,
        workingDir: options.workingDir,
        timeoutMs: options.stepTimeoutMs,
      }
    );

    if (!response.success || !response.response) {
      return {
        ok: false,
        error: response.error ?? 'Empty response from Gemini',
        trace,
      };
    }

    const action = parseAction(response.response.trim());
    const result = await executeAction({
      action,
      store,
      options,
      depth,
      task,
      expectedOutput,
    });

    if (result.done) {
      trace.push({
        step,
        action: action.action,
        toolInput: action.toolInput,
        summary: 'Final result returned',
        ok: true,
      });
      return { ok: true, result: result.result, trace };
    }

    if (result.toolResult) {
      trace.push({
        step,
        action: action.action,
        toolInput: action.toolInput,
        summary: result.toolResult.summary,
        ok: result.toolResult.ok,
      });
      lastToolResult = result.toolResult;
      if (!result.toolResult.ok) {
        return {
          ok: false,
          error: result.toolResult.error ?? 'Tool action failed',
          trace,
        };
      }
      continue;
    }

    return {
      ok: false,
      error: 'Unknown execution state',
      trace,
    };
  }

  return {
    ok: false,
    error: 'Max steps reached',
    trace,
  };
}
