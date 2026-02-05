/**
 * Gemini CLI Integration
 * 
 * Uses Gemini CLI's native headless mode with built-in:
 * - Agent Skills (auto-discovered from .gemini/skills/)
 * - Shell and file system tools
 * - JSON structured output
 * 
 * CLI Quota: 1000 calls/day with subscription
 * Auth: Run `gemini auth login` before using
 * 
 * @see https://geminicli.com/docs/cli/headless/
 * @see https://geminicli.com/docs/cli/skills/
 */

import { exec, ExecOptions } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { getConfig } from './config.js';
import { createLogger } from './logger.js';

const execAsync = promisify(exec);
const log = createLogger('Gemini');

export interface GeminiResponse {
  success: boolean;
  response?: string;
  stats?: {
    models?: Record<string, {
      tokens?: { prompt?: number; candidates?: number; total?: number };
    }>;
    tools?: {
      totalCalls?: number;
      totalSuccess?: number;
      totalFail?: number;
    };
  };
  error?: string;
}

interface GeminiJsonOutput {
  response?: string;
  stats?: GeminiResponse['stats'];
  error?: {
    type?: string;
    message?: string;
    code?: number;
  };
}

/**
 * Call Gemini CLI in headless mode
 * 
 * @param prompt - The task/question for Gemini
 * @param context - Optional data to pipe via stdin (will be JSON stringified)
 * @param options - Additional CLI options
 */
export async function callGemini(
  prompt: string,
  context?: Record<string, unknown>,
  options?: {
    model?: string;
    workingDir?: string;
    includeDirectories?: string[];
    timeoutMs?: number;
  }
): Promise<GeminiResponse> {
  const config = getConfig();
  const model = options?.model ?? config.GEMINI_MODEL;
  const timeoutMs = options?.timeoutMs ?? 300000; // 5 minute default
  
  // Build command
  const args: string[] = [
    '--prompt', `"${prompt.replace(/"/g, '\\"')}"`,
    '--model', model,
    '--output-format', 'json',
    '--yolo', // Auto-approve all tool actions (skills, shell, file access)
  ];
  
  // Add include directories if specified
  if (options?.includeDirectories?.length) {
    args.push('--include-directories', options.includeDirectories.join(','));
  }
  
  const command = `gemini ${args.join(' ')}`;
  
  log.debug('Executing:', command);
  
  const execOptions: ExecOptions = {
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large responses
    timeout: timeoutMs,
    cwd: options?.workingDir,
    encoding: 'utf8',
  };
  
  try {
    let result: { stdout: string | Buffer; stderr: string | Buffer };
    
    if (context) {
      // Pipe context data via stdin
      const contextJson = JSON.stringify(context, null, 2);
      const tempFile = path.join(os.tmpdir(), `loa-context-${Date.now()}.json`);
      
      try {
        await fs.writeFile(tempFile, contextJson, 'utf-8');
        
        // Use type (Windows) or cat (Unix) to pipe file to gemini
        const pipeCmd = process.platform === 'win32'
          ? `type "${tempFile}" | ${command}`
          : `cat "${tempFile}" | ${command}`;
        
        result = await execAsync(pipeCmd, execOptions);
      } finally {
        // Clean up temp file
        try {
          await fs.unlink(tempFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    } else {
      result = await execAsync(command, execOptions);
    }
    
    const stdout = typeof result.stdout === 'string' ? result.stdout : result.stdout.toString('utf8');
    const stderr = typeof result.stderr === 'string' ? result.stderr : result.stderr.toString('utf8');

    // Log stderr warnings (but not errors - those go in JSON)
    if (stderr && !stderr.includes('error')) {
      log.debug('Gemini stderr:', stderr);
    }
    
    // Parse JSON response
    let output: GeminiJsonOutput;
    try {
      output = JSON.parse(stdout);
    } catch (parseError) {
      // If JSON parsing fails, treat stdout as the response
      log.warn('Failed to parse JSON output, using raw stdout');
      return {
        success: true,
        response: stdout.trim(),
      };
    }
    
    // Check for error in response
    if (output.error) {
      return {
        success: false,
        error: output.error.message ?? output.error.type ?? 'Unknown error',
        stats: output.stats,
      };
    }
    
    return {
      success: true,
      response: output.response,
      stats: output.stats,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Gemini CLI error:', errorMessage);
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Call Gemini with a specific skill hint
 * 
 * While Gemini auto-discovers skills, you can hint which skill to use
 * by including it in the prompt.
 */
export async function callGeminiWithSkill(
  skillName: string,
  taskDescription: string,
  context?: Record<string, unknown>,
  options?: Parameters<typeof callGemini>[2]
): Promise<GeminiResponse> {
  // Hint the skill in the prompt - Gemini will activate_skill if appropriate
  const prompt = `Using the ${skillName} skill: ${taskDescription}`;
  
  return callGemini(prompt, context, options);
}

/**
 * Simple prompt without context data
 */
export async function prompt(
  question: string,
  options?: Parameters<typeof callGemini>[2]
): Promise<string | null> {
  const response = await callGemini(question, undefined, options);
  return response.success ? (response.response ?? null) : null;
}
