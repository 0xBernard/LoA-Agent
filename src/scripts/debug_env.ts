
console.log("Current process.env.DATABASE_URL:", process.env.DATABASE_URL);
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
// @ts-ignore
console.log("Prisma internal datasource url:", prisma._engineConfig?.datasources?.[0]?.url || "Hidden");
