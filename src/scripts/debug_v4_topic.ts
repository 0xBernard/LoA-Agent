import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Check the V4 topic specifically
  const v4Topic = await prisma.discourseTopic.findFirst({
    where: {
      slug: 'aave-v4-spokes-developer-lifecycle'
    },
    include: {
      posts: {
        orderBy: { postNumber: 'asc' }
      }
    }
  });

  if (v4Topic) {
    console.log(`Topic: ${v4Topic.title}`);
    console.log(`Post Count: ${v4Topic.posts.length}`);
    v4Topic.posts.forEach(p => {
      console.log(`\n--- Post #${p.postNumber} by ${p.authorUsername} ---`);
      console.log(p.rawContent ? p.rawContent.slice(0, 500) + "..." : "[NO RAW CONTENT]");
    });
  } else {
    console.log("V4 Topic not found in DB.");
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
