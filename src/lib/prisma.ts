/**
 * Prisma Client Singleton
 * Connects to the same database as the backend via private VLAN
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const writeActions = new Set<string>([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
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

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.AGENT_LOG_LEVEL === 'debug'
      ? ['query', 'warn', 'error']
      : ['error'],
  });

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = basePrisma;
}

export const prisma = isWriteGuardEnabled
  ? basePrisma.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (writeActions.has(operation)) {
              const modelName = model ?? 'unknown';
              if (!agentWritableModels.has(modelName)) {
                throw new Error(`Write blocked by guard for model: ${modelName}`);
              }
            }

            return query(args);
          },
        },
      },
    })
  : basePrisma;

export default prisma;
