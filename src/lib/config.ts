/**
 * Agent Configuration
 */

import { z } from 'zod';

const discordLogLevelSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.enum(['debug', 'info', 'warn', 'error', 'off']).optional()
);

const configSchema = z.object({
  // Database
  DATABASE_URL: z.string(),
  
  // Gemini
  GEMINI_MODEL: z.string().default('gemini-1.5-flash'),
  
  // Agent
  AGENT_WORKSPACE: z.string().default('./workspace'),
  AGENT_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  AGENT_CRON: z.string().default('*/30 * * * *'),
  AGENT_MEMORY_ROOT: z.string().default('./memory'),
  
  // Limits - tuned for larger context windows
  MAX_POSTS_PER_RUN: z.coerce.number().default(50),
  MAX_RETRIES: z.coerce.number().default(3),
  CODE_EXECUTION_TIMEOUT_MS: z.coerce.number().default(30000),
  FORUM_BATCH_SIZE: z.coerce.number().default(500), // Posts per Gemini call

  // RLM scaffold limits
  RLM_ENABLED: z.coerce.boolean().default(true),
  RLM_CONTEXT_BYTES_THRESHOLD: z.coerce.number().default(800000),
  RLM_MIN_POSTS: z.coerce.number().default(80),
  RLM_MAX_STEPS: z.coerce.number().default(32),
  RLM_MAX_DEPTH: z.coerce.number().default(3),
  RLM_CHUNK_BYTES: z.coerce.number().default(16000),
  RLM_MAX_READ_BYTES: z.coerce.number().default(60000),
  RLM_MAX_SECTION_BYTES: z.coerce.number().default(200000),
  RLM_MAX_SEARCH_RESULTS: z.coerce.number().default(12),
  RLM_MAX_TOOL_RESULT_CHARS: z.coerce.number().default(8000),

  // Notifications
  DISCORD_WEBHOOK_URL: z.string().optional(),
  DISCORD_NOTIFY_ON: z.string().optional(),
  DISCORD_LOG_LEVEL: discordLogLevelSchema,

  // Discord bot (optional)
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_ONBOARD_PREFIX: z.string().optional(),
  DISCORD_ALLOWED_GUILD_IDS: z.string().optional(),
  DISCORD_ALLOWED_CHANNEL_IDS: z.string().optional(),
  DISCORD_ONBOARD_CHANNELS: z.string().optional(),

  // QMD (optional)
  QMD_BIN: z.string().default('qmd'),
  QMD_INDEX: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;
  
  _config = configSchema.parse(process.env);
  return _config;
}

export function getWorkspacePath(): string {
  return getConfig().AGENT_WORKSPACE;
}
