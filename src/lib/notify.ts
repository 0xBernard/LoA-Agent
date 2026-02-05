import { getConfig } from './config.js';

export type NotifyEvent = 'task_failed' | 'draft_created' | 'task_error';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const DEFAULT_EVENTS: NotifyEvent[] = ['task_failed', 'draft_created', 'task_error'];

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_BATCH_SIZE = 20;
const LOG_FLUSH_MS = 1000;
const LOG_BUFFER_LIMIT = 200;
const LOG_MAX_ENTRY_CHARS = 900;
const DISCORD_MESSAGE_LIMIT = 1900;
const CODE_BLOCK_PREFIX = '```log\n';
const CODE_BLOCK_SUFFIX = '\n```';

let logBuffer: string[] = [];
let logFlushTimer: NodeJS.Timeout | null = null;
let logFlushInFlight = false;
let droppedLogs = 0;

function parseEvents(value?: string): Set<NotifyEvent> {
  if (!value) {
    return new Set(DEFAULT_EVENTS);
  }
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0) as NotifyEvent[];
  return new Set(entries.length > 0 ? entries : DEFAULT_EVENTS);
}

function clamp(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + '...';
}

function getWebhookUrl(config = getConfig()): string | null {
  const webhookUrl = config.DISCORD_WEBHOOK_URL?.trim();
  return webhookUrl && webhookUrl.length > 0 ? webhookUrl : null;
}

function parseLogLevel(value?: string): LogLevel | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'off') return null;
  if (normalized in levelPriority) return normalized as LogLevel;
  return null;
}

async function postWebhook(webhookUrl: string, payload: unknown, label: string): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`${label} failed: ${res.status} ${text}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${label} error: ${message}`);
  }
}

function scheduleLogFlush(): void {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(() => {
    void flushLogBuffer();
  }, LOG_FLUSH_MS);
}

function splitLogLines(lines: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const normalized = line.replace(/\r?\n/g, ' ').trim();
    if (!normalized) continue;
    const entry = `${normalized}\n`;

    if (current.length + entry.length > maxChars) {
      if (current.length > 0) {
        chunks.push(current.trimEnd());
        current = '';
      }
    }

    if (entry.length > maxChars) {
      chunks.push(clamp(normalized, maxChars - 1));
      continue;
    }

    current += entry;
  }

  if (current.length > 0) {
    chunks.push(current.trimEnd());
  }

  return chunks;
}

async function flushLogBuffer(): Promise<void> {
  if (logFlushInFlight) return;
  logFlushInFlight = true;

  if (logFlushTimer) {
    clearTimeout(logFlushTimer);
    logFlushTimer = null;
  }

  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    logBuffer = [];
    droppedLogs = 0;
    logFlushInFlight = false;
    return;
  }

  const lines = logBuffer.splice(0, logBuffer.length);
  if (droppedLogs > 0) {
    lines.unshift(`[warn] dropped ${droppedLogs} log lines (buffer full)`);
    droppedLogs = 0;
  }

  const maxChunkChars =
    DISCORD_MESSAGE_LIMIT - CODE_BLOCK_PREFIX.length - CODE_BLOCK_SUFFIX.length;
  const chunks = splitLogLines(lines, maxChunkChars);

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const content = `${CODE_BLOCK_PREFIX}${chunk}${CODE_BLOCK_SUFFIX}`;
    await postWebhook(webhookUrl, { content }, 'Discord log batch');
  }

  logFlushInFlight = false;

  if (logBuffer.length > 0) {
    scheduleLogFlush();
  }
}

export async function notifyDiscord(
  event: NotifyEvent,
  payload: {
    title: string;
    description?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    color?: number;
  }
): Promise<void> {
  const config = getConfig();
  const webhookUrl = getWebhookUrl(config);
  if (!webhookUrl) return;

  const enabled = parseEvents(config.DISCORD_NOTIFY_ON);
  if (!enabled.has(event)) return;

  const embed = {
    title: clamp(payload.title, 256),
    description: payload.description ? clamp(payload.description, 2048) : undefined,
    color: payload.color ?? 0xffb703,
    fields: payload.fields?.map((field) => ({
      name: clamp(field.name, 256),
      value: clamp(field.value, 1024),
      inline: field.inline ?? false,
    })),
    timestamp: new Date().toISOString(),
  };

  await postWebhook(webhookUrl, { embeds: [embed] }, 'Discord webhook');
}

export function notifyLog(entry: { level: LogLevel; message: string }): void {
  const config = getConfig();
  const webhookUrl = getWebhookUrl(config);
  if (!webhookUrl) return;

  const threshold = parseLogLevel(config.DISCORD_LOG_LEVEL);
  if (!threshold) return;
  if (levelPriority[entry.level] < levelPriority[threshold]) return;

  const line = clamp(entry.message, LOG_MAX_ENTRY_CHARS);
  if (logBuffer.length >= LOG_BUFFER_LIMIT) {
    droppedLogs += 1;
    return;
  }

  logBuffer.push(line);

  if (logBuffer.length >= LOG_BATCH_SIZE) {
    void flushLogBuffer();
    return;
  }

  scheduleLogFlush();
}
