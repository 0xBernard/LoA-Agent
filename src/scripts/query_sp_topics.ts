
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const spTopics = await prisma.discourseTopic.findMany({
    where: {
      title: {
        contains: "Service Provider",
        mode: 'insensitive'
      }
    },
    take: 5,
    orderBy: { createdAt: 'desc' }
  });

  console.log("--- Service Provider Topics ---");
  spTopics.forEach(t => console.log(`${t.createdAt.toISOString()} - ${t.title} (${t.url})`));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
