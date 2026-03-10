import {
  prisma
} from '../lib/prisma.js';

async function main() {
  console.log('Starting Aave Archive Analysis...');

  // 1. Get Aave Protocol
  const protocol = await prisma.protocol.findFirst({
    where: { slug: 'aave' },
    include: { governanceSpace: true }
  });

  if (!protocol) {
    console.error('Aave protocol not found');
    return;
  }

  console.log(`Found Protocol: ${protocol.title} (ID: ${protocol.id})`);
  
  // Try to find Space ID
  let spaceId = protocol.governanceSpace?.id;
  
  // Debug: Check Spaces count if not found
  if (!spaceId) {
    console.log('Governance space not directly linked. Checking available data...');
    
    // Check ForumPosts to see if we have any with topics
    const posts = await prisma.forumPost.findMany({
        take: 1,
        include: { topic: true }
    });
    if (posts.length > 0 && posts[0].topic.spaceId) {
       console.log(`Found sample post linked to spaceId: ${posts[0].topic.spaceId}`);
       // If the sample post space matches expected Aave space (often matches snapshot ID or similar)
       if (posts[0].topic.spaceId === protocol.snapshotSpaceId || posts[0].topic.spaceId.includes('aave')) {
           spaceId = posts[0].topic.spaceId;
       }
    }

    if (!spaceId && protocol.snapshotSpaceId) {
        console.log(`Trying to find space by snapshotSpaceId: ${protocol.snapshotSpaceId}`);
        const space = await prisma.space.findUnique({ where: { id: protocol.snapshotSpaceId } });
        if (space) {
            spaceId = space.id;
            console.log(`Found space via snapshotSpaceId: ${spaceId}`);
        }
    }
  }

  if (!spaceId) {
    console.error('CRITICAL: No governance space found for Aave. Cannot analyze.');
    console.log('Listing all protocols with spaces:');
    const all = await prisma.protocol.findMany({
        where: { governanceSpace: { isNot: null } },
        select: { slug: true, governanceSpace: { select: { id: true } } }
    });
    console.log(JSON.stringify(all, null, 2));
    return;
  }

  console.log(`Using Space ID: ${spaceId}`);

  // 2. Analyze Forum Authors
  console.log('\n--- Top 20 Forum Authors ---');
  const topAuthors = await prisma.$queryRaw<Array<{ author_username: string | null; post_count: bigint }>>`
    SELECT
      fp."authorUsername" AS author_username,
      COUNT(*)::bigint AS post_count
    FROM "governance"."forum_posts" fp
    JOIN "governance"."discourse_topics" dt ON dt.id = fp."topicId"
    WHERE dt."spaceId" = ${spaceId}
      AND fp."authorUsername" IS NOT NULL
    GROUP BY fp."authorUsername"
    ORDER BY post_count DESC
    LIMIT 20
  `;

  for (const author of topAuthors) {
    console.log(`${author.author_username}: ${Number(author.post_count)} posts`);
  }

  // 3. Analyze Delegates (TokenHolders with voting power)
  console.log('\n--- Top 20 Delegates (by Voting Power) ---');
  const topDelegates = await prisma.tokenHolder.findMany({
    where: {
      spaceId: spaceId,
      totalVotingPower: { gt: 0 }
    },
    orderBy: {
      totalVotingPower: 'desc'
    },
    take: 20,
    select: {
      address: true,
      totalVotingPower: true,
      publicTag: true,
      aliases: true
    }
  });

  for (const delegate of topDelegates) {
    const alias = delegate.aliases.length > 0 ? delegate.aliases[0].alias : 'N/A';
    // Handle potential Decimal/null
    const vp = delegate.totalVotingPower ? delegate.totalVotingPower.toString() : '0';
    console.log(`${delegate.address} (${alias}): ${vp} VP`);
  }

  // 4. Timeline Analysis
  console.log('\n--- Timeline ---');
  const earliestPost = await prisma.forumPost.findFirst({
    where: { topic: { spaceId: spaceId } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, topic: { select: { title: true } } }
  });

  const latestPost = await prisma.forumPost.findFirst({
    where: { topic: { spaceId: spaceId } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, topic: { select: { title: true } } }
  });

  console.log(`Earliest Post: ${earliestPost?.createdAt.toISOString()} - ${earliestPost?.topic.title}`);
  console.log(`Latest Post: ${latestPost?.createdAt.toISOString()} - ${latestPost?.topic.title}`);

  // 5. Service Providers
  console.log('\n--- Known Service Providers ---');
  const allSPs = await prisma.serviceProvider.findMany();
  for (const sp of allSPs) {
      console.log(`- ${sp.displayName} (${sp.category})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
