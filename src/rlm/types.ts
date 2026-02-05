export type RlmActionType =
  | 'list_sections'
  | 'list_chunks'
  | 'read_section'
  | 'read_chunk'
  | 'read_range'
  | 'search'
  | 'web_fetch'
  | 'fs_list'
  | 'fs_read'
  | 'qmd_search'
  | 'qmd_vsearch'
  | 'qmd_query'
  | 'qmd_get'
  | 'qmd_multi_get'
  | 'qmd_status'
  | 'db_search_posts'
  | 'db_get_posts'
  | 'db_get_posts_by_author'
  | 'db_get_posts_after'
  | 'recurse'
  | 'final';

export interface RlmAction {
  action: RlmActionType;
  toolInput?: Record<string, unknown>;
  result?: unknown;
  notes?: string;
}

export interface RlmToolResult {
  tool: RlmActionType;
  ok: boolean;
  summary: string;
  data?: unknown;
  truncated?: boolean;
  error?: string;
}

export interface RlmRunOptions {
  model?: string;
  skillName?: string;
  workingDir?: string;
  fsScope?: {
    rootDir: string;
    allowPatterns?: string[]; // Glob patterns
  };
  dbScope?: {
    protocolId?: string;
    spaceId?: string | null;
    lastProcessedPostId?: number;
  };
  maxSteps?: number;
  maxDepth?: number;
  maxReadBytes?: number;
  maxSectionBytes?: number;
  maxSearchResults?: number;
  maxToolResultChars?: number;
  chunkBytes?: number;
  workspaceDir?: string;
  stepTimeoutMs?: number;
}

export interface RlmTraceStep {
  step: number;
  action: RlmActionType;
  toolInput?: Record<string, unknown>;
  summary: string;
  ok: boolean;
}

export interface RlmRunResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  trace: RlmTraceStep[];
}
