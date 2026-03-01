import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

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

function extractFirstJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}

function parseGeminiTaskResult(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = stdout;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const maybeWrapper = parsed as { response?: unknown; error?: unknown };

    if (maybeWrapper.error) {
      throw new Error(`Gemini returned an error: ${JSON.stringify(maybeWrapper.error)}`);
    }

    if (typeof maybeWrapper.response === 'string') {
      const payload = extractFirstJsonObject(maybeWrapper.response);
      return JSON.parse(payload) as Record<string, unknown>;
    }

    // Already a task result object.
    return parsed as Record<string, unknown>;
  }

  if (typeof parsed === 'string') {
    const payload = extractFirstJsonObject(parsed);
    return JSON.parse(payload) as Record<string, unknown>;
  }

  throw new Error('Unexpected Gemini output format');
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

async function main(): Promise<void> {
  console.log('🤖 Loa Agent Harness Starting...');

  const instructionsPath = path.resolve(process.cwd(), DRIVER_INSTRUCTIONS);
  const instructions = await fs.readFile(instructionsPath, 'utf-8');

  let completed = 0;

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

    const prompt = buildPrompt(instructions, taskType);

    console.log('🧠 Invoking Gemini CLI...');
    const result = await runGemini(prompt);

    await fs.writeFile(RESULT_FILE, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`💾 Saved result to ${RESULT_FILE}`);

    await submitTask(taskId);
    completed += 1;
    console.log(`✅ Submitted task ${taskId}`);
  }

  console.log(`\n🏁 Harness finished. Completed tasks: ${completed}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('❌ Harness failed:', message);
  process.exit(1);
});
