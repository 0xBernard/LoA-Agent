/**
 * Prisma Client Singleton
 * Connects to the same database as the backend via private VLAN
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const writeActions = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'executeRaw',
  'executeRawUnsafe',
  'runCommandRaw',
]);

const agentWritableModels = new Set([
  'ProtocolAgentContext',
  'EntityObservation',
  'AgentTask',
  'AgentExecutionLog',
  'ProtocolSourceDoc',
  'ProtocolEntity',
  'AgentDraft',
  'SmartContract',
  'EntityReport',
]);

const isWriteGuardEnabled = process.env.AGENT_DB_WRITE_GUARD !== 'off';

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.AGENT_LOG_LEVEL === 'debug' 
      ? ['query', 'warn', 'error'] 
      : ['error'],
  });

if (isWriteGuardEnabled) {
  prisma.$use(async (params, next) => {
    if (writeActions.has(params.action)) {
      const modelName = params.model ?? 'unknown';
      if (!agentWritableModels.has(modelName)) {
        throw new Error(`Write blocked by guard for model: ${modelName}`);
      }
    }
    return next(params);
  });
}

globalForPrisma.prisma = prisma;

export default prisma;





