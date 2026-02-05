
import { prisma } from '../lib/prisma.js';

async function main() {
  console.log('Checking Aave Agent Cursor vs Risk/Dev Posts...');

  const protocol = await prisma.protocol.findFirst({ where: { slug: 'aave' } });
  if (!protocol) throw new Error('Aave not found');

  const context = await prisma.protocolAgentContext.findUnique({
    where: { protocolId: protocol.id }
  });

  console.log(`Agent Context:`);
  console.log(`- Last Processed Post ID: ${context?.lastProcessedPostId}`);
  console.log(`- Is Onboarded: ${context?.isOnboarded}`);

  // Find Risk/Dev category IDs first if possible, or just search by topic title/slug keywords
  // Actually, we can check DiscourseTopic categories if we knew the IDs, but let's just look at recent imports.
  // We'll look for posts in topics with "Risk" or "Development" in title, or just check the distribution of IDs.
  
  // Let's get the range of IDs in the DB
  const minMax = await prisma.forumPost.aggregate({
    _min: { discoursePostId: true },
    _max: { discoursePostId: true }
  });
  console.log(`DB Post ID Range: ${minMax._min.discoursePostId} - ${minMax._max.discoursePostId}`);

  // Check specifically for the Gauntlet exit thread posts
  // Title "Gauntlet is leaving Aave"
  const gauntletTopic = await prisma.discourseTopic.findFirst({
      where: { title: { contains: 'Gauntlet is leaving Aave' } }
  });

  if (gauntletTopic) {
      console.log(`
Gauntlet Exit Topic Found: ${gauntletTopic.title} (ID: ${gauntletTopic.topicId})`);
      const posts = await prisma.forumPost.findMany({
          where: { topicId: gauntletTopic.id },
          select: { discoursePostId: true, createdAt: true, authorUsername: true },
          orderBy: { discoursePostId: 'asc' }
      });
      console.log(`Posts in thread: ${posts.length}`);
      if (posts.length > 0) {
          console.log(`- First Post ID: ${posts[0].discoursePostId}`);
          console.log(`- Last Post ID: ${posts[posts.length-1].discoursePostId}`);
          
          const missed = posts.filter(p => p.discoursePostId < (context?.lastProcessedPostId ?? 0));
          console.log(`- Posts with ID < AgentCursor: ${missed.length} (These will be SKIPPED by standard sync)`);
      }
  } else {
      console.log('Gauntlet exit topic not found in DB yet.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
