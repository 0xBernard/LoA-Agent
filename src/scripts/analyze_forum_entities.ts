
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("--- Mining Ecosystem Data ---");

  // 1. Identify Key Authors (Potential Delegates/SPs)
  const topAuthors = await prisma.forumAuthor.findMany({
    orderBy: {
      forumPosts: {
        _count: 'desc'
      }
    },
    take: 10,
    include: {
      _count: { 
        select: { forumPosts: true, discourseTopics: true }
      }
    }
  });

  console.log("\nTop 10 Contributors:");
  topAuthors.forEach(a => {
    console.log(`- ${a.username} (${a._count.forumPosts} posts, ${a._count.discourseTopics} topics)`);
  });

  // 2. Find Delegate Platforms
  const platformTopics = await prisma.discourseTopic.findMany({
    where: {
      title: { contains: "Delegate Platform", mode: 'insensitive' }
    },
    take: 5
  });

  console.log("\nDelegate Platforms Found:");
  platformTopics.forEach(t => console.log(`- ${t.title} (${t.url})`));

  // 3. Find Key Reports (Chaos Labs, Gauntlet, Financials)
  const reportTerms = ["Risk Review", "Financial Report", "GHO Update", "Parameter Update"];
  const reports = await prisma.discourseTopic.findMany({
    where: {
      OR: reportTerms.map(term => ({ title: { contains: term, mode: 'insensitive' } }))
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  console.log("\nRecent Official Reports:");
  reports.forEach(t => console.log(`- [${t.createdAt.toISOString().split('T')[0]}] ${t.title}`));

  // 4. Find ACI specific activity (Governance Facilitator)
  const aciTopics = await prisma.discourseTopic.findMany({
    where: {
      OR: [
        { authorUsername: { contains: "ACI", mode: 'insensitive' } },
        { title: { contains: "ACI", mode: 'insensitive' } }
      ]
    },
    take: 5,
    orderBy: { createdAt: 'desc' }
  });
  
  console.log("\nRecent ACI Activity:");
  aciTopics.forEach(t => console.log(`- ${t.title}`));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
