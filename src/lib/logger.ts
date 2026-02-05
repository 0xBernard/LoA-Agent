/**
 * Simple logger for the agent
 */

import { getConfig } from './config.js';
import { notifyLog } from './notify.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  const configLevel = getConfig().AGENT_LOG_LEVEL;
  return levelPriority[level] >= levelPriority[configLevel];
}

function formatMessage(level: LogLevel, context: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}`;
}

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return '';
  const parts = args.map((arg) => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack ?? arg.message;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  });
  return parts.join(' ');
}

function buildNotifyLine(
  level: LogLevel,
  context: string,
  message: string,
  args: unknown[]
): string {
  const base = formatMessage(level, context, message);
  const extra = formatArgs(args);
  return extra ? `${base} ${extra}` : base;
}

export function createLogger(context: string) {
  return {
    debug: (message: string, ...args: unknown[]) => {
      notifyLog({ level: 'debug', message: buildNotifyLine('debug', context, message, args) });
      if (shouldLog('debug')) {
        console.debug(formatMessage('debug', context, message), ...args);
      }
    },
    info: (message: string, ...args: unknown[]) => {
      notifyLog({ level: 'info', message: buildNotifyLine('info', context, message, args) });
      if (shouldLog('info')) {
        console.info(formatMessage('info', context, message), ...args);
      }
    },
    warn: (message: string, ...args: unknown[]) => {
      notifyLog({ level: 'warn', message: buildNotifyLine('warn', context, message, args) });
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', context, message), ...args);
      }
    },
    error: (message: string, ...args: unknown[]) => {
      notifyLog({ level: 'error', message: buildNotifyLine('error', context, message, args) });
      if (shouldLog('error')) {
        console.error(formatMessage('error', context, message), ...args);
      }
    },
  };
}

export const log = createLogger('Agent');





