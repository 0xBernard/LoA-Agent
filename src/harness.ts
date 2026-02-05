
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

// Configuration
const CONTEXT_FILE = 'task-context.json';
const RESULT_FILE = 'result.json';
const DRIVER_INSTRUCTIONS = 'DRIVER_INSTRUCTIONS.md';

async function runCommand(command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(command);
    return stdout.trim();
  } catch (error: any) {
    console.error(`Command failed: ${command}`);
    console.error(error.stderr || error.message);
    throw error;
  }
}

async function main() {
  console.log("🤖 Loa Agent Harness Starting...");
  
  let working = true;
  let taskCount = 0;

  while (working) {
    console.log(`\n--- Cycle ${taskCount + 1} ---`);

    // 1. Fetch Next Task
    console.log("Checking for tasks...");
    await runCommand(`npm run tool:next -- ${CONTEXT_FILE}`);
    
    // Read context to see if we have a task
    const contextRaw = await fs.readFile(CONTEXT_FILE, 'utf-8');
    const context = JSON.parse(contextRaw);

    if (!context.found) {
      console.log("✅ No pending tasks. Queue empty.");
      working = false;
      break;
    }

    const taskId = context.task.id;
    const taskType = context.task.type;
    console.log(`📋 Processing Task: ${taskId} (${taskType})`);

    // 2. Construct Prompt for the Agent
    // We read the instructions and append the specific context for this run
    const instructions = await fs.readFile(DRIVER_INSTRUCTIONS, 'utf-8');
    const prompt = `
${instructions}

---

**CURRENT TASK CONTEXT:**
(The context has been loaded into ${CONTEXT_FILE}. Read it to begin.)

**YOUR GOAL:**
1. Read ${CONTEXT_FILE}.
2. Perform the '${taskType}' skill.
3. Save the output to ${RESULT_FILE}.
4. DO NOT call 'tool:submit' yourself. The harness will do it.
    `.trim();

    // 3. Invoke the Agent (Gemini CLI)
    // Note: We use --yolo to allow tools, and pipe the prompt
    console.log("🧠 Invoking Agent...");
    
    // Escape prompt for shell (basic escaping, might need robustness for complex chars)
    const escapedPrompt = prompt.replace(/"/g, '\