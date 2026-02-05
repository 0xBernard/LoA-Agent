/**
 * Sandbox for Agent Code Execution
 * 
 * Executes LLM-generated TypeScript code in a controlled environment.
 * The code has access to our tools (DbTool, RepoTool) but limited system access.
 * 
 * Philosophy: Per Cloudflare's "Code Mode" research, LLMs are better at
 * writing code than making tool calls. We execute their code in a sandbox.
 * 
 * @see https://blog.cloudflare.com/code-mode/
 */

import * as vm from 'vm';
import { getConfig } from './config.js';
import { createLogger } from './logger.js';

// Import tools to expose in sandbox
import * as DbTool from '../tools/db.js';
import * as RepoTool from '../tools/repo.js';
import * as EntityTool from '../tools/entities.js';
import * as OutputTool from '../tools/output.js';

const log = createLogger('Sandbox');

export interface SandboxResult {
  success: boolean;
  result?: unknown;
  error?: string;
  executionMs: number;
}

/**
 * Transform TypeScript-like code to executable JavaScript
 * This is a simple transform - the LLM should generate mostly JS-compatible code
 */
function transformCode(code: string): string {
  // Remove TypeScript type annotations (simple cases)
  let transformed = code
    // Remove type imports
    .replace(/import\s+type\s+.*?;/g, '')
    // Remove interface declarations
    .replace(/interface\s+\w+\s*\{[^}]*\}/g, '')
    // Remove type aliases
    .replace(/type\s+\w+\s*=\s*[^;]+;/g, '')
    // Remove type annotations from variables
    .replace(/:\s*\w+(\[\])?\s*=/g, ' =')
    // Remove type annotations from function parameters (simple)
    .replace(/\(([^)]*)\)\s*:\s*\w+/g, '($1)')
    // Remove generic type parameters
    .replace(/<[^>]+>/g, '')
    // Remove 'as' type assertions
    .replace(/\s+as\s+\w+/g, '');
  
  // Wrap in async IIFE if it contains top-level await
  if (transformed.includes('await ') && !transformed.includes('async function')) {
    transformed = `(async () => {\n${transformed}\n})()`;
  }
  
  return transformed;
}

/**
 * Create a sandboxed context with our tools
 */
function createSandboxContext(): vm.Context {
  // Create a minimal global object
  const sandbox = {
    // Our tools - the main interface for the agent
    DbTool,
    RepoTool,
    EntityTool,
    OutputTool,
    
    // Safe console for debugging
    console: {
      log: (...args: unknown[]) => log.info('Agent:', ...args),
      warn: (...args: unknown[]) => log.warn('Agent:', ...args),
      error: (...args: unknown[]) => log.error('Agent:', ...args),
    },
    
    // Essential JavaScript globals
    Promise,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date,
    Math,
    JSON,
    Map,
    Set,
    RegExp,
    Error,
    TypeError,
    RangeError,
    
    // Async utilities
    setTimeout: (fn: () => void, ms: number) => {
      // Cap timeouts at 10 seconds
      return setTimeout(fn, Math.min(ms, 10000));
    },
    
    // Allow the code to return results
    __result__: undefined as unknown,
  };
  
  return vm.createContext(sandbox);
}

/**
 * Execute generated code in the sandbox
 */
export async function runInSandbox(code: string): Promise<SandboxResult> {
  const startTime = Date.now();
  const timeout = getConfig().CODE_EXECUTION_TIMEOUT_MS;
  
  try {
    // Transform TypeScript to JavaScript
    const jsCode = transformCode(code);
    
    log.debug('Executing code:', jsCode.slice(0, 500));
    
    // Create isolated context
    const context = createSandboxContext();
    
    // Wrap code to capture result
    const wrappedCode = `
      (async () => {
        try {
          ${jsCode}
        } catch (e) {
          throw e;
        }
      })()
    `;
    
    // Compile the script
    const script = new vm.Script(wrappedCode, {
      filename: 'agent-generated.js',
    });
    
    // Run with timeout
    const resultPromise = script.runInContext(context, {
      timeout,
      displayErrors: true,
    });
    
    // Await the async result
    const result = await Promise.race([
      resultPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Execution timeout')), timeout)
      ),
    ]);
    
    return {
      success: true,
      result,
      executionMs: Date.now() - startTime,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Sandbox execution failed:', errorMessage);
    
    return {
      success: false,
      error: errorMessage,
      executionMs: Date.now() - startTime,
    };
  }
}

/**
 * Validate code before execution (basic safety checks)
 */
export function validateCode(code: string): { valid: boolean; reason?: string } {
  // Block dangerous patterns
  const dangerousPatterns = [
    /require\s*\(/,           // No require()
    /import\s+.*\s+from/,     // No dynamic imports (static imports are stripped)
    /process\./,              // No process access
    /child_process/,          // No spawning
    /\beval\s*\(/,            // No eval
    /Function\s*\(/,          // No Function constructor
    /globalThis/,             // No globalThis
    /Reflect\./,              // No Reflect
    /Proxy/,                  // No Proxy
    /__proto__/,              // No prototype pollution
    /\.constructor/,          // No constructor access
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(code)) {
      return { 
        valid: false, 
        reason: `Code contains forbidden pattern: ${pattern.source}` 
      };
    }
  }
  
  // Check code length
  if (code.length > 50000) {
    return { valid: false, reason: 'Code exceeds maximum length (50KB)' };
  }
  
  return { valid: true };
}

