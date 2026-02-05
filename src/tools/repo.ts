/**
 * Repository Tool for Loa Agent
 * 
 * Provides filesystem and git operations for analyzing protocol repositories.
 * Used during protocol onboarding to understand technical architecture.
 * 
 * Security: All operations are sandboxed to the workspace directory.
 */

import { simpleGit, SimpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getWorkspacePath } from '../lib/config.js';

// ============================================================================
// Path Safety
// ============================================================================

function getWorkspace(): string {
  return getWorkspacePath();
}

/**
 * Resolve and validate a path is within the workspace
 */
function safePath(relativePath: string): string {
  const workspace = getWorkspace();
  const resolved = path.resolve(workspace, relativePath);
  
  if (!resolved.startsWith(path.resolve(workspace))) {
    throw new Error(`Path "${relativePath}" is outside the workspace`);
  }
  
  return resolved;
}

// ============================================================================
// Git Operations
// ============================================================================

export interface CloneResult {
  success: boolean;
  localPath: string;
  error?: string;
}

/**
 * Clone a git repository into the workspace
 */
export async function clone(
  repoUrl: string,
  options?: {
    targetDir?: string;
    depth?: number;
    branch?: string;
  }
): Promise<CloneResult> {
  const workspace = getWorkspace();
  
  // Ensure workspace exists
  await fs.mkdir(workspace, { recursive: true });
  
  // Extract repo name from URL for default target
  const repoName = options?.targetDir ?? 
    repoUrl.split('/').pop()?.replace(/\.git$/, '') ?? 
    'repo';
  
  const targetPath = path.join(workspace, repoName);
  
  const git: SimpleGit = simpleGit(workspace);
  
  // If directory exists, pull instead of clone
  try {
    await fs.access(targetPath);
    const repoGit = simpleGit(targetPath);
    await repoGit.pull();
    return { success: true, localPath: targetPath };
  } catch {
    // Directory doesn't exist, proceed with clone
  }
  
  try {
    const cloneOptions: string[] = [];
    
    if (options?.depth) {
      cloneOptions.push('--depth', String(options.depth));
    } else {
      cloneOptions.push('--depth', '1');
    }
    
    if (options?.branch) {
      cloneOptions.push('--branch', options.branch);
    }
    
    await git.clone(repoUrl, repoName, cloneOptions);
    return { success: true, localPath: targetPath };
  } catch (error) {
    return {
      success: false,
      localPath: targetPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Filesystem Operations
// ============================================================================

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

// Directories to skip when listing
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  'target',
  'dist',
  'build',
  '.next',
  'coverage',
  '.cache',
  'vendor',
]);

/**
 * List files in a directory
 */
export async function listFiles(
  dirPath: string = '.',
  options?: {
    recursive?: boolean;
    maxDepth?: number;
  }
): Promise<FileInfo[]> {
  const fullPath = safePath(dirPath);
  const workspace = getWorkspace();
  const results: FileInfo[] = [];
  const maxDepth = options?.maxDepth ?? (options?.recursive ? 5 : 1);
  
  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    
    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    
    for (const entry of entries) {
      // Skip hidden files and ignored directories
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
        continue;
      }
      
      const entryPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(workspace, entryPath);
      
      if (entry.isDirectory()) {
        results.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
        });
        
        if (depth < maxDepth) {
          await walk(entryPath, depth + 1);
        }
      } else {
        const stats = await fs.stat(entryPath);
        results.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
          size: stats.size,
        });
      }
    }
  }
  
  await walk(fullPath, 1);
  return results;
}

/**
 * Read a file's contents
 */
export async function readFile(
  filePath: string,
  options?: {
    maxSize?: number;
    encoding?: BufferEncoding;
  }
): Promise<string> {
  const fullPath = safePath(filePath);
  const maxSize = options?.maxSize ?? 100 * 1024; // 100KB default
  const encoding = options?.encoding ?? 'utf-8';
  
  const stats = await fs.stat(fullPath);
  
  if (stats.size > maxSize) {
    const fileHandle = await fs.open(fullPath, 'r');
    const buffer = Buffer.alloc(maxSize);
    await fileHandle.read(buffer, 0, maxSize, 0);
    await fileHandle.close();
    return buffer.toString(encoding) + '\n\n[... truncated ...]';
  }
  
  return fs.readFile(fullPath, encoding);
}

/**
 * Check if a file or directory exists
 */
export async function exists(targetPath: string): Promise<boolean> {
  try {
    const fullPath = safePath(targetPath);
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file stats
 */
export async function stat(filePath: string): Promise<{
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  modifiedAt: Date;
}> {
  const fullPath = safePath(filePath);
  const stats = await fs.stat(fullPath);
  
  return {
    size: stats.size,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    modifiedAt: stats.mtime,
  };
}

// ============================================================================
// Code Analysis Helpers
// ============================================================================

/**
 * Find files by extension
 */
export async function findByExtension(
  dirPath: string,
  extensions: string[]
): Promise<FileInfo[]> {
  const allFiles = await listFiles(dirPath, { recursive: true, maxDepth: 6 });
  const extSet = new Set(extensions.map(e => e.startsWith('.') ? e : `.${e}`));
  
  return allFiles.filter(f => {
    if (f.type !== 'file') return false;
    const ext = path.extname(f.name);
    return extSet.has(ext);
  });
}

/**
 * Get a quick overview of a repository structure
 */
export async function getRepoOverview(repoPath: string = '.'): Promise<{
  hasReadme: boolean;
  readmePath?: string;
  hasContracts: boolean;
  contractsPath?: string;
  hasSrc: boolean;
  srcPath?: string;
  mainLanguage?: string;
  topLevelDirs: string[];
  keyFiles: string[];
}> {
  const files = await listFiles(repoPath, { recursive: true, maxDepth: 3 });
  
  const topLevelDirs = files
    .filter(f => f.type === 'directory' && !f.path.includes('/') && !f.path.includes('\\'))
    .map(f => f.name);
  
  const readmeFile = files.find(f => 
    f.type === 'file' && /^readme\.md$/i.test(f.name)
  );
  
  const contractsDir = files.find(f =>
    f.type === 'directory' && /^contracts?$/i.test(f.name)
  );
  
  const srcDir = files.find(f =>
    f.type === 'directory' && /^src$/i.test(f.name)
  );
  
  // Detect main language by file extensions
  const extCounts: Record<string, number> = {};
  for (const f of files) {
    if (f.type === 'file') {
      const ext = path.extname(f.name);
      extCounts[ext] = (extCounts[ext] ?? 0) + 1;
    }
  }
  
  const languageMap: Record<string, string> = {
    '.sol': 'Solidity',
    '.rs': 'Rust',
    '.ts': 'TypeScript',
    '.js': 'JavaScript',
    '.py': 'Python',
    '.go': 'Go',
    '.cairo': 'Cairo',
    '.move': 'Move',
  };
  
  let mainLanguage: string | undefined;
  let maxCount = 0;
  for (const [ext, count] of Object.entries(extCounts)) {
    if (languageMap[ext] && count > maxCount) {
      maxCount = count;
      mainLanguage = languageMap[ext];
    }
  }
  
  // Key files to look for
  const keyFilePatterns = [
    /^package\.json$/,
    /^Cargo\.toml$/,
    /^foundry\.toml$/,
    /^hardhat\.config\./,
    /^truffle-config\./,
    /^pyproject\.toml$/,
    /^go\.mod$/,
  ];
  
  const keyFiles = files
    .filter(f => f.type === 'file' && keyFilePatterns.some(p => p.test(f.name)))
    .map(f => f.path);
  
  return {
    hasReadme: !!readmeFile,
    readmePath: readmeFile?.path,
    hasContracts: !!contractsDir,
    contractsPath: contractsDir?.path,
    hasSrc: !!srcDir,
    srcPath: srcDir?.path,
    mainLanguage,
    topLevelDirs,
    keyFiles,
  };
}

/**
 * Search for text in files (simple grep-like)
 */
export async function searchInFiles(
  dirPath: string,
  pattern: string | RegExp,
  options?: {
    extensions?: string[];
    maxResults?: number;
  }
): Promise<Array<{ file: string; line: number; content: string }>> {
  const files = options?.extensions 
    ? await findByExtension(dirPath, options.extensions)
    : await listFiles(dirPath, { recursive: true, maxDepth: 5 });
  
  const results: Array<{ file: string; line: number; content: string }> = [];
  const regex = typeof pattern === 'string' ? new RegExp(pattern, 'gi') : pattern;
  const maxResults = options?.maxResults ?? 100;
  
  for (const file of files) {
    if (file.type !== 'file') continue;
    if (results.length >= maxResults) break;
    
    try {
      const content = await readFile(file.path);
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push({
            file: file.path,
            line: i + 1,
            content: lines[i].trim().slice(0, 200),
          });
          
          if (results.length >= maxResults) break;
        }
        // Reset regex lastIndex for global patterns
        regex.lastIndex = 0;
      }
    } catch {
      // Skip files that can't be read
    }
  }
  
  return results;
}





