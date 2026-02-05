import * as fs from 'fs/promises';
import * as path from 'path';
import { getConfig } from '../lib/config.js';

export interface PromptStoreOptions {
  chunkBytes?: number;
  workspaceDir?: string;
  title?: string;
}

export interface PromptSectionInput {
  id: string;
  label?: string;
  content: string;
  meta?: Record<string, unknown>;
}

export interface PromptChunkInfo {
  id: number;
  start: number;
  end: number;
  preview: string;
}

export interface PromptSectionInfo {
  id: string;
  label?: string;
  start: number;
  end: number;
  meta?: Record<string, unknown>;
  preview?: string;
}

export interface PromptSectionPreview extends PromptSectionInfo {
  preview: string;
  bytes: number;
}

export interface PromptMeta {
  title?: string;
  sizeBytes: number;
  lineCount: number;
  chunkCount: number;
  sectionCount: number;
  chunkBytes: number;
  filePath: string;
}

const DEFAULT_CHUNK_BYTES = 8000;
const PREVIEW_BYTES = 160;

function getWorkspaceDir(options?: PromptStoreOptions): string {
  if (options?.workspaceDir) {
    return options.workspaceDir;
  }
  return path.join(getConfig().AGENT_WORKSPACE, 'rlm');
}

function makeFileName(prefix: string): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${suffix}.txt`;
}

async function readBytes(filePath: string, start: number, end: number): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const length = Math.max(0, end - start);
    const buffer = Buffer.alloc(length);
    if (length === 0) {
      return buffer;
    }
    await handle.read(buffer, 0, length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

async function countLines(filePath: string, sizeBytes: number): Promise<number> {
  if (sizeBytes === 0) return 0;
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let lines = 0;
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 10) {
          lines++;
        }
      }
      position += bytesRead;
    }
    return lines + 1;
  } finally {
    await handle.close();
  }
}

function buildChunksFromBuffer(buffer: Buffer, chunkBytes: number): PromptChunkInfo[] {
  const chunks: PromptChunkInfo[] = [];
  let offset = 0;
  let id = 0;
  while (offset < buffer.length) {
    const end = Math.min(offset + chunkBytes, buffer.length);
    const preview = buffer.slice(offset, Math.min(end, offset + PREVIEW_BYTES)).toString('utf8');
    chunks.push({ id, start: offset, end, preview });
    offset = end;
    id += 1;
  }
  return chunks;
}

async function buildChunksFromFile(filePath: string, sizeBytes: number, chunkBytes: number): Promise<PromptChunkInfo[]> {
  const chunks: PromptChunkInfo[] = [];
  const handle = await fs.open(filePath, 'r');
  try {
    let offset = 0;
    let id = 0;
    const previewBuffer = Buffer.alloc(PREVIEW_BYTES);
    while (offset < sizeBytes) {
      const end = Math.min(offset + chunkBytes, sizeBytes);
      const previewLength = Math.min(PREVIEW_BYTES, end - offset);
      if (previewLength > 0) {
        await handle.read(previewBuffer, 0, previewLength, offset);
      }
      const preview = previewLength > 0 ? previewBuffer.slice(0, previewLength).toString('utf8') : '';
      chunks.push({ id, start: offset, end, preview });
      offset = end;
      id += 1;
    }
  } finally {
    await handle.close();
  }
  return chunks;
}

export class PromptStore {
  private filePath: string;
  private sizeBytes: number;
  private chunks: PromptChunkInfo[];
  private sections: PromptSectionInfo[];
  private lineCount: number;
  private chunkBytes: number;
  private title?: string;

  private constructor(params: {
    filePath: string;
    sizeBytes: number;
    chunks: PromptChunkInfo[];
    sections: PromptSectionInfo[];
    lineCount: number;
    chunkBytes: number;
    title?: string;
  }) {
    this.filePath = params.filePath;
    this.sizeBytes = params.sizeBytes;
    this.chunks = params.chunks;
    this.sections = params.sections;
    this.lineCount = params.lineCount;
    this.chunkBytes = params.chunkBytes;
    this.title = params.title;
  }

  static async fromFile(filePath: string, options?: PromptStoreOptions): Promise<PromptStore> {
    const chunkBytes = options?.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    const stats = await fs.stat(filePath);
    const sizeBytes = stats.size;
    const chunks = await buildChunksFromFile(filePath, sizeBytes, chunkBytes);
    const lineCount = await countLines(filePath, sizeBytes);
    return new PromptStore({
      filePath,
      sizeBytes,
      chunks,
      sections: [],
      lineCount,
      chunkBytes,
      title: options?.title,
    });
  }

  static async fromText(text: string, options?: PromptStoreOptions): Promise<PromptStore> {
    const workspaceDir = getWorkspaceDir(options);
    await fs.mkdir(workspaceDir, { recursive: true });
    const filePath = path.join(workspaceDir, makeFileName('prompt'));
    await fs.writeFile(filePath, text, 'utf8');
    return PromptStore.fromFile(filePath, options);
  }

  static async fromSections(
    title: string,
    sections: PromptSectionInput[],
    options?: PromptStoreOptions
  ): Promise<PromptStore> {
    const workspaceDir = getWorkspaceDir(options);
    await fs.mkdir(workspaceDir, { recursive: true });
    const filePath = path.join(workspaceDir, makeFileName('prompt'));
    const chunkBytes = options?.chunkBytes ?? DEFAULT_CHUNK_BYTES;

    const sectionInfos: PromptSectionInfo[] = [];
    const parts: Buffer[] = [];
    let offset = 0;

    for (const section of sections) {
      const headerParts = [`SECTION ${section.id}`];
      if (section.label) {
        headerParts.push(`label="${section.label}"`);
      }
      const header = `--- ${headerParts.join(' ')} ---\n`;
      const metaLine = section.meta ? `META ${JSON.stringify(section.meta)}\n` : '';
      const body = section.content.trimEnd() + '\n\n';
      const sectionText = header + metaLine + body;
      const preview = section.content.slice(0, PREVIEW_BYTES);

      const buffer = Buffer.from(sectionText, 'utf8');
      const start = offset;
      offset += buffer.length;
      const end = offset;
      parts.push(buffer);
      sectionInfos.push({
        id: section.id,
        label: section.label,
        start,
        end,
        meta: section.meta,
        preview,
      });
    }

    const combined = Buffer.concat(parts);
    await fs.writeFile(filePath, combined);

    const chunks = buildChunksFromBuffer(combined, chunkBytes);
    const lineCount = combined.toString('utf8').split('\n').length - 1 + (combined.length > 0 ? 1 : 0);

    return new PromptStore({
      filePath,
      sizeBytes: combined.length,
      chunks,
      sections: sectionInfos,
      lineCount,
      chunkBytes,
      title,
    });
  }

  getMeta(): PromptMeta {
    return {
      title: this.title,
      sizeBytes: this.sizeBytes,
      lineCount: this.lineCount,
      chunkCount: this.chunks.length,
      sectionCount: this.sections.length,
      chunkBytes: this.chunkBytes,
      filePath: this.filePath,
    };
  }

  listChunks(limit: number = 20, offset: number = 0): PromptChunkInfo[] {
    return this.chunks.slice(offset, offset + limit);
  }

  listSections(limit: number = 20, offset: number = 0): PromptSectionPreview[] {
    const slice = this.sections.slice(offset, offset + limit);
    return slice.map((section) => {
      const preview = section.preview ?? '';
      return {
        ...section,
        bytes: section.end - section.start,
        preview,
      };
    });
  }

  async getChunk(id: number): Promise<{ chunk: PromptChunkInfo; text: string }> {
    const chunk = this.chunks[id];
    if (!chunk) {
      throw new Error(`Chunk not found: ${id}`);
    }
    const buffer = await readBytes(this.filePath, chunk.start, chunk.end);
    return { chunk, text: buffer.toString('utf8') };
  }

  async getRange(start: number, end: number): Promise<{ start: number; end: number; text: string }> {
    if (start < 0 || end < 0 || end < start) {
      throw new Error('Invalid range');
    }
    const clampedStart = Math.max(0, Math.min(start, this.sizeBytes));
    const clampedEnd = Math.max(clampedStart, Math.min(end, this.sizeBytes));
    const buffer = await readBytes(this.filePath, clampedStart, clampedEnd);
    return { start: clampedStart, end: clampedEnd, text: buffer.toString('utf8') };
  }

  async getSection(id: string, maxBytes?: number): Promise<{ section: PromptSectionInfo; text: string; truncated: boolean }> {
    const section = this.sections.find((item) => item.id === id);
    if (!section) {
      throw new Error(`Section not found: ${id}`);
    }
    let end = section.end;
    let truncated = false;
    if (typeof maxBytes === 'number' && maxBytes > 0 && end - section.start > maxBytes) {
      end = section.start + maxBytes;
      truncated = true;
    }
    const buffer = await readBytes(this.filePath, section.start, end);
    return { section, text: buffer.toString('utf8'), truncated };
  }

  async search(query: string, options?: { limit?: number; caseSensitive?: boolean }): Promise<Array<{ start: number; end: number; chunkId: number; snippet: string }>> {
    const limit = options?.limit ?? 5;
    const caseSensitive = options?.caseSensitive ?? false;
    const needle = caseSensitive ? query : query.toLowerCase();
    const matches: Array<{ start: number; end: number; chunkId: number; snippet: string }> = [];

    for (const chunk of this.chunks) {
      if (matches.length >= limit) break;
      const { text } = await this.getChunk(chunk.id);
      const haystack = caseSensitive ? text : text.toLowerCase();
      let index = haystack.indexOf(needle);
      while (index !== -1 && matches.length < limit) {
        const prefixBytes = Buffer.byteLength(text.slice(0, index), 'utf8');
        const start = chunk.start + prefixBytes;
        const end = start + Buffer.byteLength(query, 'utf8');
        const snippetStart = Math.max(0, index - 60);
        const snippetEnd = Math.min(text.length, index + query.length + 60);
        const snippet = text.slice(snippetStart, snippetEnd);
        matches.push({ start, end, chunkId: chunk.id, snippet });
        index = haystack.indexOf(needle, index + query.length);
      }
    }

    return matches;
  }
}
