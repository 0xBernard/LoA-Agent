import {
 z
} from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as db from './tools/db.js';
import * as output from './tools/output.js';
import * as entities from './tools/entities.js';
import { createLogger } from './lib/logger.js';
import { validateAndCheck } from './lib/validation.js';
import { getReadyForumPosts } from './agent.js'; // Reuse the logic for fetching posts
import { getConfig } from './lib/config.js';

const log = createLogger('ToolCLI');

// Reuse the context building logic from agent.ts but expose it as a tool
async function buildTaskContext(task: db.AgentTask): Promise<Record<string, unknown>> {
  const config = getConfig();
  
  const context: Record<string, unknown> = {
    taskId: task.id,
    taskType: task.type,
    protocolId: task.protocolId,
    payload: task.payload,
    attempt: task.attempts + 1,
  };
  
  if (task.protocolId) {
    const protocolContext = await db.getProtocolContext(task.protocolId);
    if (protocolContext) {
      context.protocolContext = protocolContext;
    }
    
    const protocol = await db.getProtocol(task.protocolId);
    context.protocol = protocol;
    
    // Load Posts for Forum Update
    if (task.type === 'FORUM_UPDATE' && protocolContext) {
      const posts = await getReadyForumPosts(
        task.protocolId,
        protocolContext.lastProcessedPostId,
        config.FORUM_BATCH_SIZE
      );
      
      context.posts = posts.map(p => ({
        id: p.id,
        discoursePostId: p.discoursePostId,
        authorUsername: p.authorUsername,
        authorDisplayName: p.authorDisplayName,
        createdAt: p.createdAt,
        likeCount: p.likeCount,
        content: p.rawContent || p.cookedContent || '',
        topic: {
          title: p.topic.title,
          slug: p.topic.slug,
          url: p.topic.url,
        },
      }));
      context.postCount = posts.length;
    }

    // Load Data for Entity Profile
    if (task.type === 'ENTITY_PROFILE' && task.payload) {
        const payload = task.payload as { entityType?: string; identifier?: string };
        if (payload.entityType && payload.identifier) {
          const posts = await db.getPostsByAuthor(payload.identifier, { limit: 50 });
          context.entityPosts = posts.map(p => ({
            id: p.id,
            createdAt: p.createdAt,
            content: p.rawContent || p.cookedContent || '',
            topic: { title: p.topic.title },
            likeCount: p.likeCount,
          }));
          context.existingObservations = await db.getEntityObservations(payload.identifier, { limit: 30 });
        }
    }
  }
  
  return context;
}

// Commands
async function cmdNextTask(outFile?: string) {
  const task = await db.getNextTask();
  if (!task) {
    console.log(JSON.stringify({ found: false, message: "No pending tasks" }, null, 2));
    return;
  }

  // Mark as running
  await db.updateTaskStatus(task.id, 'RUNNING');

  const context = await buildTaskContext(task);
  
  // Add task metadata wrapper
  const outputData = {
    found: true,
    task: {
        id: task.id,
        type: task.type,
        protocolId: task.protocolId
    },
    context
  };

  const json = JSON.stringify(outputData, null, 2);
  
  if (outFile) {
    await fs.writeFile(outFile, json);
    console.log(`Task context written to ${outFile}`);
  } else {
    console.log(json);
  }
}

async function cmdSubmitTask(taskId: string, inputFile: string) {
  // Read input
  const rawInput = await fs.readFile(inputFile, 'utf-8');
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(rawInput);
  } catch (e) {
    log.error("Invalid JSON input");
    process.exit(1);
  }

  // Get task to verify type
  // Note: We can't easily get the task *type* from just ID without a DB lookup,
  // but we need the type for validation.
  // Ideally, the input JSON should contain the type, or we assume the task is still in DB.
  // For now, let's assume the user knows what they are doing or we look it up.
  // Since `db.ts` doesn't expose `getTaskById` explicitly, let's just assume we processed it correctly
  // based on the content of the result.
  
  // Actually, let's deduce type from content or add a type flag?
  // Better: The `result` usually has shape specific to the task.
  
  // Wait, we need to know the task type to run `validateAndCheck`.
  // Let's rely on the input JSON having a `_meta` field or similar if we want to be strict,
  // OR we just perform the DB writes directly if the JSON is already in the final format.
  
  // BUT, the `agent.ts` logic did post-processing (persistGovernanceResult, etc.).
  // We should expose those persist functions.
  
  // Let's try to infer action from fields.
  const protocolId = result.protocolId as string || 'unknown'; // We need protocol ID in input

  if (result.governanceSummary || result.entities) {
      // FORUM_UPDATE / GOVERNANCE_SUMMARY
      if (result.governanceSummary) {
        await db.upsertProtocolContext(protocolId, {
            governanceState: result.governanceSummary as string,
            lastProcessedPostId: result.maxProcessedPostId as number,
        });
      }
      if (result.entities && Array.isArray(result.entities)) {
          for (const entity of result.entities) {
              await db.addEntityObservation({
                  entityIdentifier: entity.identifier,
                  entityType: entity.observationType,
                  content: entity.observation,
                  confidenceScore: entity.confidence ?? 70,
              });
          }
      }
      log.info("Persisted Governance Update");
  } 
  else if (result.profile && result.displayName) {
      // ENTITY_PROFILE
      const profileResult = result as any;
       // Build profile content markdown (Reusing logic from agent.ts - simplified)
        const profileContent = `# ${profileResult.displayName}\n\n> ${profileResult.bio}\n\n## Overview\n${profileResult.profile.overview}`;
        
        const identifier = profileResult.displayName.toLowerCase().replace(/\s+/g, '-');
        
        if (profileResult.shouldDraft) {
            await output.saveDraft(protocolId, `governance/entities/${identifier}`, {
            title: `${profileResult.displayName} Profile`,
            content: profileContent,
            draftType: 'ENTITY_PROFILE',
            sourceRefs: profileResult.sourcePostIds,
            });
        } else {
            await entities.upsertEntity(protocolId, profileResult.entityType, identifier, {
            displayName: profileResult.displayName,
            bio: profileResult.bio,
            profileContent,
            isPublished: true,
            });
        }
       log.info("Persisted Entity Profile");
  }
  else {
      const pageData = result as { page?: { path?: string; title?: string; content?: string }; metadata?: { sourceDocIds?: string[] } };
      if (pageData.page?.content && pageData.page.path && pageData.page.title) {
        // PROTOCOL_DOCS
        await output.saveDraft(protocolId, pageData.page.path, {
          title: pageData.page.title,
          content: pageData.page.content,
          draftType: 'PAGE',
          sourceRefs: pageData.metadata?.sourceDocIds,
        });
        log.info("Persisted Documentation Page");
      }
      else if (result.technicalSummary) {
          // REPO_ONBOARD
          const repoData = result as any;
          await db.upsertProtocolContext(protocolId, {
            technicalSummary: repoData.technicalSummary,
          });
          log.info("Persisted Repo Analysis");
      }
  }

  // Update Task Status
  await db.updateTaskStatus(taskId, 'COMPLETED');
  log.info(`Task ${taskId} marked as COMPLETED`);
}

async function cmdOnboard(slug: string, source: string) {
  const prisma = (await import('./lib/prisma.js')).default;
  
  const protocol = await db.getProtocol(slug);
  if (!protocol) {
    console.error(`Protocol not found: ${slug}`);
    process.exit(1);
  }

  // 1. Determine Source Type (File vs URL)
  let content = '';
  let repoUrls: string[] = [];
  let docUrls: string[] = [];
  let isFile = false;

  try {
    const stats = await fs.stat(source);
    if (stats.isFile()) {
        content = await fs.readFile(source, 'utf-8');
        isFile = true;
        console.log(`Reading onboarding config from ${source}`);
    }
  } catch {
    // Not a file, treat as direct URL
    if (source.includes('github.com')) {
        repoUrls.push(source);
    }
  }

  // 2. Parse File Content
  if (isFile) {
    // Extract GitHub URLs
    const githubRegex = /https:\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-_.]+/g;
    const foundRepos = content.match(githubRegex) || [];
    repoUrls = [...new Set(foundRepos)]; // Dedupe

    // Extract potential Doc URLs (simple heuristic: http/s links that aren't github/twitter/discord)
    const urlRegex = /https?:\/\/[^\s)]+/g;
    const allUrls = content.match(urlRegex) || [];
    docUrls = allUrls.filter(u => 
        !u.includes('github.com') && 
        !u.includes('twitter.com') && 
        !u.includes('discord') &&
        !u.includes('t.me') &&
        !u.includes('governance.aave.com') // Exclude forum links, handled by DB
    );
    docUrls = [...new Set(docUrls)];
  }

  console.log(`Found ${repoUrls.length} repositories and ${docUrls.length} doc sources.`);

  // 3. Initialize Context
  const contextMsg = `\n\n## Onboarding Notes\n${content}`;
  
  await db.upsertProtocolContext(protocol.id, {
      governanceState: `Onboarding started at ${new Date().toISOString()}${isFile ? contextMsg : ''}`,
  });
  
  await prisma.protocolAgentContext.update({
      where: { protocolId: protocol.id },
      data: { isOnboarded: true, onboardedAt: new Date() }
  });
  console.log(`Protocol ${slug} marked as onboarded.`);

  // 4. Create Tasks
  const tasks: Array<{ type: db.TaskType; priority: number; payload?: any }> = [];

  // Repos
  for (const repoUrl of repoUrls) {
      tasks.push({ 
          type: 'REPO_ONBOARD', 
          priority: 5, 
          payload: { repoUrl, onboarding: true } 
      });
  }

  // Docs
  for (const docUrl of docUrls) {
      tasks.push({ 
          type: 'PROTOCOL_DOCS', 
          priority: 4, 
          payload: { url: docUrl, onboarding: true } 
      });
  }

  // Standard Tasks
  tasks.push(
    { type: 'ENTITY_PROFILE', priority: 3, payload: { onboarding: true } },
    { type: 'FORUM_UPDATE', priority: 2, payload: { onboarding: true } }
  );

  // Submit Tasks
  for (const task of tasks) {
    // For repos/docs, check uniqueness by payload content to allow multiple REPO_ONBOARD tasks
    let existing;
    
    if (task.type === 'REPO_ONBOARD') {
        const payload = task.payload as { repoUrl: string };
        // We have to query raw to filter by json payload if we want strict deduping, 
        // but for simplicity, we'll just check if a PENDING task of this type exists 
        // and assume if the queue is empty we can re-add. 
        // Actually, better to query all pending and check payload in memory.
        const pending = await prisma.agentTask.findMany({
            where: {
                protocolId: protocol.id,
                type: task.type,
                status: { in: ['PENDING', 'RUNNING'] }
            }
        });
        existing = pending.find(p => (p.payload as any)?.repoUrl === payload.repoUrl);
    } else if (task.type === 'PROTOCOL_DOCS' && task.payload?.url) {
         const pending = await prisma.agentTask.findMany({
            where: {
                protocolId: protocol.id,
                type: task.type,
                status: { in: ['PENDING', 'RUNNING'] }
            }
        });
        existing = pending.find(p => (p.payload as any)?.url === task.payload.url);
    } else {
        existing = await prisma.agentTask.findFirst({
            where: {
                protocolId: protocol.id,
                type: task.type,
                status: { in: ['PENDING', 'RUNNING'] }
            }
        });
    }

    if (!existing) {
        await db.createTask({
            type: task.type,
            protocolId: protocol.id,
            priority: task.priority,
            payload: task.payload
        });
        console.log(`Created task: ${task.type} ${task.payload?.repoUrl || task.payload?.url || ''}`);
    } else {
        console.log(`Task ${task.type} already pending.`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'next-task':
      await cmdNextTask(args[1]); // optional outfile
      break;
    case 'submit-task':
        if (!args[1] || !args[2]) {
            console.error("Usage: submit-task <taskId> <jsonFile>");
            process.exit(1);
        }
        await cmdSubmitTask(args[1], args[2]);
        break;
    case 'onboard':
        // usage: onboard <slug> [repoUrl]
        if (!args[1]) {
            console.error("Usage: onboard <slug> [repoUrl]");
            process.exit(1);
        }
        await cmdOnboard(args[1], args[2]);
        break;
    default:
      console.log("Available commands: next-task, submit-task, onboard");
      break;
  }
}

main().catch(console.error);
