import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

const CONTEXT_FILE = 'task-context.json';
const RESULT_FILE = 'result.json';
const DRIVER_INSTRUCTIONS = 'DRIVER_INSTRUCTIONS.md';
const MAX_CYCLES = 100;

interface TaskEnvelope {
  id: string;
  type: string;
  protocolId?: string | null;
}

interface TaskContextFile {
  found: boolean;
  task?: TaskEnvelope;
  context?: Record<string, unknown>;
}

async function runNpm(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync('npm', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (stderr?.trim()) {
    // npm often writes lifecycle noise to stderr; keep it visible but non-fatal
    console.error(stderr.trim());
  }

  return stdout.trim();
}

async function fetchNextTask(): Promise<TaskContextFile> {
  await runNpm(['run', 'tool:next', '--', CONTEXT_FILE]);
  const contextRaw = await fs.readFile(CONTEXT_FILE, 'utf-8');
  return JSON.parse(contextRaw) as TaskContextFile;
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse failures
  }

  return null;
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  const direct = tryParseObject(trimmed);
  if (direct) {
    return direct;
  }

  const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];
  for (const block of fencedBlocks) {
    const candidate = block[1]?.trim();
    if (!candidate) continue;

    const parsed = tryParseObject(candidate);
    if (parsed) {
      return parsed;
    }
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaping = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth === 0) {
        continue;
      }

      depth -= 1;

      if (depth === 0 && start !== -1) {
        const candidate = trimmed.slice(start, i + 1);
        const parsed = tryParseObject(candidate);
        if (parsed) {
          return parsed;
        }
        start = -1;
      }
    }
  }

  throw new Error('Unable to extract a valid JSON object from Gemini output');
}

function parseGeminiTaskResult(stdout: string): Record<string, unknown> {
  const parsed = tryParseObject(stdout);

  if (parsed) {
    const maybeWrapper = parsed as { response?: unknown; error?: unknown };

    if (maybeWrapper.error) {
      throw new Error(`Gemini returned an error: ${JSON.stringify(maybeWrapper.error)}`);
    }

    if (typeof maybeWrapper.response === 'string') {
      return extractJsonObject(maybeWrapper.response);
    }

    // Already a task result object.
    return parsed;
  }

  return extractJsonObject(stdout);
}

async function runGemini(prompt: string): Promise<Record<string, unknown>> {
  const { stdout, stderr } = await execFileAsync(
    'gemini',
    [
      '--prompt',
      prompt,
      '--output-format',
      'json',
      '--yolo',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    }
  );

  if (stderr?.trim()) {
    console.error(stderr.trim());
  }

  return parseGeminiTaskResult(stdout);
}

async function submitTask(taskId: string): Promise<void> {
  await runNpm(['run', 'tool:submit', '--', taskId, RESULT_FILE]);
}

async function failTask(taskId: string, errorMessage: string): Promise<void> {
  await runNpm(['run', 'tool:fail', '--', taskId, errorMessage]);
}

function buildPrompt(instructions: string, taskType: string): string {
  return `
${instructions}

---

CURRENT TASK CONTEXT:
- The context has been written to ${CONTEXT_FILE}.
- Read that file first.

YOUR GOAL:
1. Read ${CONTEXT_FILE}.
2. Perform the '${taskType}' skill.
3. Save the output as strict JSON to ${RESULT_FILE}.
4. Do NOT call tool:submit yourself; the harness handles submission.
`.trim();
}

function hasApiKeyConfigured(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  );
}

async function hasGeminiCliAuth(): Promise<boolean> {
  try {
    await execFileAsync('gemini', ['auth', 'status'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

async function hasApplicationDefaultCredentials(): Promise<boolean> {
  const adcPath = path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');

  try {
    await fs.access(adcPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureGeminiAuthReady(): Promise<void> {
  if (hasApiKeyConfigured()) {
    return;
  }

  if (await hasGeminiCliAuth()) {
    return;
  }

  if (await hasApplicationDefaultCredentials()) {
    return;
  }

  throw new Error(
    [
      'Gemini authentication not detected.',
      'Configure one of the following before running the harness:',
      '- Gemini CLI OAuth: gemini auth login',
      '- Google ADC OAuth: gcloud auth application-default login',
      '- API key env: GEMINI_API_KEY (or GOOGLE_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY)',
    ].join('\n')
  );
}

async function main(): Promise<void> {
  console.log('🤖 Loa Agent Harness Starting...');

  await ensureGeminiAuthReady();

  const instructionsPath = path.resolve(process.cwd(), DRIVER_INSTRUCTIONS);
  const instructions = await fs.readFile(instructionsPath, 'utf-8');

  let completed = 0;
  let failed = 0;

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    console.log(`\n--- Cycle ${cycle} ---`);
    console.log('Checking for tasks...');

    const envelope = await fetchNextTask();

    if (!envelope.found || !envelope.task?.id || !envelope.task?.type) {
      console.log('✅ No pending tasks. Queue empty.');
      break;
    }

    const taskId = envelope.task.id;
    const taskType = envelope.task.type;
    console.log(`📋 Processing task: ${taskId} (${taskType})`);

    try {
      const prompt = buildPrompt(instructions, taskType);

      console.log('🧠 Invoking Gemini CLI...');
      const result = await runGemini(prompt);

      await fs.writeFile(RESULT_FILE, JSON.stringify(result, null, 2), 'utf-8');
      console.log(`💾 Saved result to ${RESULT_FILE}`);

      await submitTask(taskId);
      completed += 1;
      console.log(`✅ Submitted task ${taskId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed += 1;
      console.error(`❌ Task ${taskId} failed: ${message}`);

      try {
        await failTask(taskId, message);
        console.log(`📝 Marked task ${taskId} as FAILED`);
      } catch (markFailedError) {
        const markMessage = markFailedError instanceof Error ? markFailedError.message : String(markFailedError);
        console.error(`⚠️ Failed to mark task ${taskId} as FAILED: ${markMessage}`);
      }

      continue;
    }
  }

  console.log(`\n🏁 Harness finished. Completed tasks: ${completed}, failed tasks: ${failed}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Harness failed:', message);
  process.exit(1);
});
