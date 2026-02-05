
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Use DATABASE_URL=postgresql://user:password@db-host:5432/library_of_alexandria?schema=public',
    );
  }
  console.log("Searching database for Aave V4 and Service Provider info...");

  // Search Terms
  const terms = ["V4", "Architecture", "Service Provider", "Gauntlet", "Chaos Labs", "Aera"];
  
  // 1. Search Forum Topics
  const topics = await prisma.discourseTopic.findMany({
    where: {
      OR: terms.map(term => ({
        title: {
          contains: term,
          mode: 'insensitive' // Requires preview feature or specific collation, but usually works with default if configured
        }
      })),
      // Filter for Aave space if possible. The schema has spaceId. 
      // We don't know the exact Aave spaceId, but usually it's 'aave.eth' or similar.
      // Let's filter by checking if it has related posts first.
    },
    include: {
      posts: {
        where: {
          postNumber: 1
        },
        select: {
          rawContent: true
        }
      }
    },
    take: 20,
    orderBy: {
      createdAt: 'desc'
    }
  });

  console.log(`Found ${topics.length} relevant forum topics.`);
  
  const topicResults = topics.map(t => ({
    title: t.title,
    slug: t.slug,
    url: t.url,
    createdAt: t.createdAt,
    snippet: t.posts[0]?.rawContent?.slice(0, 500) || "No content"
  }));

  console.log(JSON.stringify(topicResults, null, 2));

  // 2. Search Source Docs (Agent Schema)
  // We need to check if we can access the 'agent' schema models.
  // The schema defined 'ProtocolSourceDoc' in 'agent' schema.
  
  // Note: Searching across schemas requires the connection user to have access.
  // Assuming the generated client handles it.
  
  const sourceDocs = await prisma.protocolSourceDoc.findMany({
    where: {
        OR: terms.map(term => ({
            title: {
                contains: term,
                mode: 'insensitive'
            }
        }))
    },
    take: 5
  });

  console.log(`Found ${sourceDocs.length} relevant source docs.`);
  console.log(JSON.stringify(sourceDocs, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
