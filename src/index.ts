/**
 * Loa Agent Entry Point
 * 
 * Autonomous Documentation Agent for Library of Alexandria
 * 
 * Usage:
 *   npm run dev                                    # Run once (process tasks)
 *   npm run agent:daemon                           # Run on schedule
 *   npm run agent:onboard -- --protocol=aave      # Onboard a new protocol
 *   npm run agent:export -- --protocol=aave       # Export approved drafts
 *   npm run agent:drafts -- --protocol=aave       # List drafts
 *   npm run agent:rlm -- --file=./input.txt --task="Summarize changes"  # RLM scaffold
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as fs from 'fs/promises';
import * as path from 'path';
import cron from 'node-cron';
import { getConfig } from './lib/config.js';
import { createLogger } from './lib/logger.js';
import { runOnce, onboardProtocol, getOnboardingStatus } from './agent.js';
import * as output from './tools/output.js';
import * as db from './tools/db.js';
import { PromptStore, runRlm } from './rlm/index.js';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('Main');

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(): {
  command: 'run' | 'daemon' | 'onboard' | 'export' | 'drafts' | 'status' | 'rlm';
  protocol?: string;
  output?: string;
  status?: string;
  file?: string;
  task?: string;
} {
  const args = process.argv.slice(2);
  
  // Determine command
  let command: 'run' | 'daemon' | 'onboard' | 'export' | 'drafts' | 'status' | 'rlm' = 'run';
  
  if (args.includes('--daemon')) {
    command = 'daemon';
  } else if (args.includes('--onboard') || args.some(a => a.startsWith('onboard'))) {
    command = 'onboard';
  } else if (args.includes('--export') || args.some(a => a.startsWith('export'))) {
    command = 'export';
  } else if (args.includes('--drafts') || args.some(a => a.startsWith('drafts'))) {
    command = 'drafts';
  } else if (args.includes('--status')) {
    command = 'status';
  } else if (args.includes('--rlm') || args.some(a => a.startsWith('rlm'))) {
    command = 'rlm';
  }
  
  // Parse named arguments
  const getArg = (name: string): string | undefined => {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    return arg?.split('=')[1];
  };
  
  return {
    command,
    protocol: getArg('protocol'),
    output: getArg('output') ?? './drafts',
    status: getArg('status'),
    file: getArg('file'),
    task: getArg('task'),
  };
}

// ============================================================================
// Commands
// ============================================================================

async function cmdOnboard(protocolSlug: string): Promise<void> {
  log.info(`Onboarding protocol: ${protocolSlug}`);
  
  // Find protocol by slug
  const protocol = await db.getProtocol(protocolSlug);
  if (!protocol) {
    log.error(`Protocol not found: ${protocolSlug}`);
    log.info('Available protocols with governance:');
    const protocols = await db.listProtocolsWithGovernance();
    for (const p of protocols) {
      log.info(`  - ${p.slug} (${p.title})`);
    }
    process.exit(1);
  }
  
  // Check if already onboarded
  const status = await getOnboardingStatus(protocol.id);
  if (status.isOnboarded) {
    log.warn(`Protocol ${protocolSlug} is already onboarded (${status.onboardedAt?.toISOString()})`);
    log.info(`Pending tasks: ${status.pendingTasks}`);
    return;
  }
  
  // Onboard
  await onboardProtocol(protocol.id);
  log.info(`Protocol ${protocolSlug} onboarded successfully!`);
  log.info('Run the agent to process the initial tasks.');
}

async function cmdExport(protocolSlug: string, outputDir: string): Promise<void> {
  log.info(`Exporting approved drafts for: ${protocolSlug}`);
  
  const protocol = await db.getProtocol(protocolSlug);
  if (!protocol) {
    log.error(`Protocol not found: ${protocolSlug}`);
    process.exit(1);
  }
  
  const result = await output.exportAllApprovedDrafts(protocol.id, outputDir);
  
  log.info(`Export complete:`);
  log.info(`  Exported: ${result.exported}`);
  log.info(`  Failed: ${result.failed}`);
  
  if (result.failed > 0) {
    log.warn('Failed exports:');
    for (const r of result.results.filter(r => !r.success)) {
      log.warn(`  - ${r.pagePath}: ${r.error}`);
    }
  }
}

async function cmdDrafts(protocolSlug: string, statusFilter?: string): Promise<void> {
  const protocol = await db.getProtocol(protocolSlug);
  if (!protocol) {
    log.error(`Protocol not found: ${protocolSlug}`);
    process.exit(1);
  }
  
  // Get stats
  const stats = await output.getDraftStats(protocol.id);
  log.info(`Draft statistics for ${protocolSlug}:`);
  log.info(`  Total: ${stats.total}`);
  log.info(`  Pending: ${stats.pending}`);
  log.info(`  Approved: ${stats.approved}`);
  log.info(`  Rejected: ${stats.rejected}`);
  log.info(`  Published: ${stats.published}`);
  
  // List drafts
  const drafts = await output.listDrafts(protocol.id, {
    status: statusFilter as output.DraftStatus | undefined,
    limit: 50,
  });
  
  if (drafts.length === 0) {
    log.info('\nNo drafts found.');
    return;
  }
  
  log.info(`\nDrafts${statusFilter ? ` (${statusFilter})` : ''}:`);
  for (const draft of drafts) {
    const date = draft.updatedAt.toISOString().split('T')[0];
    log.info(`  [${draft.status}] ${draft.pagePath} - "${draft.title}" (${date})`);
  }
}

async function cmdStatus(protocolSlug: string): Promise<void> {
  const protocol = await db.getProtocol(protocolSlug);
  if (!protocol) {
    log.error(`Protocol not found: ${protocolSlug}`);
    process.exit(1);
  }
  
  const status = await getOnboardingStatus(protocol.id);
  const context = await db.getProtocolContext(protocol.id);
  const draftStats = await output.getDraftStats(protocol.id);
  
  log.info(`Status for ${protocolSlug}:`);
  log.info(`  Onboarded: ${status.isOnboarded ? 'Yes' : 'No'}`);
  if (status.onboardedAt) {
    log.info(`  Onboarded at: ${status.onboardedAt.toISOString()}`);
  }
  if (status.lastFullSyncAt) {
    log.info(`  Last full sync: ${status.lastFullSyncAt.toISOString()}`);
  }
  log.info(`  Pending tasks: ${status.pendingTasks}`);
  log.info(`  Last processed post ID: ${context?.lastProcessedPostId ?? 0}`);
  log.info(`  Forum delay: ${context?.forumDelayDays ?? 7} days min, ${context?.forumQuietDays ?? 2} days quiet`);
  log.info(`  Drafts: ${draftStats.total} total (${draftStats.pending} pending)`);
}

async function cmdRlm(filePath: string, task: string, skillName?: string): Promise<void> {
  const config = getConfig();
  const resolved = path.resolve(filePath);
  await fs.access(resolved);

  log.info(`RLM input: ${resolved}`);
  log.info(`RLM task: ${task}`);
  if (skillName) log.info(`RLM skill: ${skillName}`);

  const store = await PromptStore.fromFile(resolved, {
    chunkBytes: config.RLM_CHUNK_BYTES,
    workspaceDir: path.join(config.AGENT_WORKSPACE, 'rlm'),
  });

  const result = await runRlm({
    store,
    task,
    expectedOutput: 'Return JSON in the "result" field.',
    options: {
      model: config.GEMINI_MODEL,
      skillName: skillName ?? 'recursive-tools', // Use provided skill or default
      chunkBytes: config.RLM_CHUNK_BYTES,
      maxSteps: config.RLM_MAX_STEPS,
      maxDepth: config.RLM_MAX_DEPTH,
      maxReadBytes: config.RLM_MAX_READ_BYTES,
      maxSectionBytes: config.RLM_MAX_SECTION_BYTES,
      maxSearchResults: config.RLM_MAX_SEARCH_RESULTS,
      maxToolResultChars: config.RLM_MAX_TOOL_RESULT_CHARS,
      workspaceDir: path.join(config.AGENT_WORKSPACE, 'rlm'),
    },
  });

  if (!result.ok) {
    log.error(`RLM failed: ${result.error ?? 'Unknown error'}`);
    process.exit(1);
  }

  log.info('RLM result:', JSON.stringify(result.result, null, 2));
}

async function cmdDaemon(): Promise<void> {
  const config = getConfig();
  
  log.info(`Schedule: ${config.AGENT_CRON}`);
  
  // Validate cron expression
  if (!cron.validate(config.AGENT_CRON)) {
    log.error(`Invalid cron expression: ${config.AGENT_CRON}`);
    process.exit(1);
  }
  
  // Run immediately on startup
  log.info('Running initial sync...');
  await runOnce().catch(err => {
    log.error('Initial run failed:', err);
  });
  
  // Schedule future runs
  cron.schedule(config.AGENT_CRON, async () => {
    log.info('Scheduled run triggered');
    await runOnce().catch(err => {
      log.error('Scheduled run failed:', err);
    });
  }, {
    timezone: 'UTC',
  });
  
  log.info('Daemon started. Press Ctrl+C to stop.');
  
  // Keep process alive
  process.on('SIGINT', () => {
    log.info('Shutting down...');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    log.info('Received SIGTERM, shutting down...');
    process.exit(0);
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs();
  
  log.info('╔════════════════════════════════════════╗');
  log.info('║     Loa Agent - Starting Up            ║');
  log.info('╚════════════════════════════════════════╝');
  
  const config = getConfig();
  log.info(`Workspace: ${config.AGENT_WORKSPACE}`);
  log.info(`Command: ${args.command}`);
  
  switch (args.command) {
    case 'daemon':
      await cmdDaemon();
      break;
      
    case 'onboard':
      if (!args.protocol) {
        log.error('Protocol required. Usage: --protocol=<slug>');
        process.exit(1);
      }
      await cmdOnboard(args.protocol);
      break;
      
    case 'export':
      if (!args.protocol) {
        log.error('Protocol required. Usage: --protocol=<slug> --output=<dir>');
        process.exit(1);
      }
      await cmdExport(args.protocol, args.output!);
      break;
      
    case 'drafts':
      if (!args.protocol) {
        log.error('Protocol required. Usage: --protocol=<slug> [--status=<status>]');
        process.exit(1);
      }
      await cmdDrafts(args.protocol, args.status);
      break;
      
    case 'status':
      if (!args.protocol) {
        log.error('Protocol required. Usage: --status --protocol=<slug>');
        process.exit(1);
      }
      await cmdStatus(args.protocol);
      break;
      
    case 'rlm':
      if (!args.file || !args.task) {
        log.error('File and task required. Usage: --rlm --file=<path> --task=<description>');
        process.exit(1);
      }
      
      // Parse skill from raw args if not in parseArgs output (hacky but quick fix)
      const skillArg = process.argv.find(a => a.startsWith('--skill='));
      const skillName = skillArg ? skillArg.split('=')[1] : undefined;
      
      await cmdRlm(args.file, args.task, skillName);
      break;
      
    case 'run':
    default:
      try {
        await runOnce();
        log.info('Run complete');
        process.exit(0);
      } catch (error) {
        log.error('Run failed:', error);
        process.exit(1);
      }
  }
}

main().catch(err => {
  log.error('Fatal error:', err);
  process.exit(1);
});
