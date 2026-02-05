/**
 * Entity Tools for Loa Agent
 * 
 * Manages protocol entities: delegates, service providers, key users.
 * Handles both the internal entity database and profile content generation.
 */

import prisma from '../lib/prisma.js';

// ============================================================================
// Types
// ============================================================================

export type EntityType = 'DELEGATE' | 'SERVICE_PROVIDER' | 'KEY_USER';

export interface ProtocolEntity {
  id: string;
  protocolId: string;
  entityType: EntityType;
  identifier: string;
  displayName: string;
  bio: string | null;
  profileContent: string | null;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityWithObservations extends ProtocolEntity {
  observations: Array<{
    id: string;
    content: string;
    entityType: string;
    confidenceScore: number;
    createdAt: Date;
  }>;
}

// ============================================================================
// Entity CRUD Operations
// ============================================================================

/**
 * Get an entity by identifier
 */
export async function getEntity(
  protocolId: string,
  entityType: EntityType,
  identifier: string
): Promise<ProtocolEntity | null> {
  return prisma.protocolEntity.findUnique({
    where: {
      protocolId_entityType_identifier: {
        protocolId,
        entityType,
        identifier,
      },
    },
  });
}

/**
 * Get an entity with its observations
 */
export async function getEntityWithObservations(
  protocolId: string,
  entityType: EntityType,
  identifier: string
): Promise<EntityWithObservations | null> {
  const entity = await getEntity(protocolId, entityType, identifier);
  if (!entity) return null;

  const observations = await prisma.entityObservation.findMany({
    where: {
      entityIdentifier: identifier,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      content: true,
      entityType: true,
      confidenceScore: true,
      createdAt: true,
    },
  });

  return { ...entity, observations };
}

/**
 * List entities for a protocol
 */
export async function listEntities(
  protocolId: string,
  options?: {
    entityType?: EntityType;
    publishedOnly?: boolean;
    limit?: number;
  }
): Promise<ProtocolEntity[]> {
  return prisma.protocolEntity.findMany({
    where: {
      protocolId,
      ...(options?.entityType && { entityType: options.entityType }),
      ...(options?.publishedOnly && { isPublished: true }),
    },
    orderBy: { displayName: 'asc' },
    take: options?.limit ?? 100,
  });
}

/**
 * Create or update an entity
 */
export async function upsertEntity(
  protocolId: string,
  entityType: EntityType,
  identifier: string,
  data: {
    displayName: string;
    bio?: string;
    profileContent?: string;
    isPublished?: boolean;
  }
): Promise<ProtocolEntity> {
  return prisma.protocolEntity.upsert({
    where: {
      protocolId_entityType_identifier: {
        protocolId,
        entityType,
        identifier,
      },
    },
    create: {
      protocolId,
      entityType,
      identifier,
      displayName: data.displayName,
      bio: data.bio ?? null,
      profileContent: data.profileContent ?? null,
      isPublished: data.isPublished ?? false,
    },
    update: {
      displayName: data.displayName,
      ...(data.bio !== undefined && { bio: data.bio }),
      ...(data.profileContent !== undefined && { profileContent: data.profileContent }),
      ...(data.isPublished !== undefined && { isPublished: data.isPublished }),
    },
  });
}

/**
 * Update entity profile content
 */
export async function updateEntityProfile(
  protocolId: string,
  entityType: EntityType,
  identifier: string,
  profileContent: string,
  publish: boolean = false
): Promise<ProtocolEntity | null> {
  try {
    return await prisma.protocolEntity.update({
      where: {
        protocolId_entityType_identifier: {
          protocolId,
          entityType,
          identifier,
        },
      },
      data: {
        profileContent,
        isPublished: publish,
      },
    });
  } catch {
    return null;
  }
}

/**
 * Publish an entity profile (make it visible)
 */
export async function publishEntity(
  protocolId: string,
  entityType: EntityType,
  identifier: string
): Promise<boolean> {
  try {
    await prisma.protocolEntity.update({
      where: {
        protocolId_entityType_identifier: {
          protocolId,
          entityType,
          identifier,
        },
      },
      data: { isPublished: true },
    });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Entity Discovery
// ============================================================================

/**
 * Discover potential entities from forum activity
 * Returns usernames that appear frequently but aren't tracked yet
 */
export async function discoverEntitiesFromForum(
  protocolId: string,
  options?: {
    minPosts?: number;
    since?: Date;
  }
): Promise<Array<{ username: string; postCount: number }>> {
  const minPosts = options?.minPosts ?? 5;
  const since = options?.since ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days

  // Get active forum authors
  const results = await prisma.$queryRaw<Array<{ username: string; post_count: bigint }>>`
    SELECT 
      fp."authorUsername" as username,
      COUNT(*)::bigint as post_count
    FROM "governance"."forum_posts" fp
    JOIN "governance"."discourse_topics" dt ON fp."topicId" = dt.id
    JOIN "governance"."governance_spaces" gs ON dt."spaceId" = gs.id
    WHERE 
      gs."protocolId" = ${protocolId}
      AND fp."authorUsername" IS NOT NULL
      AND fp."createdAt" >= ${since}
    GROUP BY fp."authorUsername"
    HAVING COUNT(*) >= ${minPosts}
    ORDER BY post_count DESC
    LIMIT 50
  `;

  // Filter out already tracked entities
  const trackedEntities = await prisma.protocolEntity.findMany({
    where: { protocolId },
    select: { identifier: true },
  });
  
  const trackedSet = new Set(trackedEntities.map(e => e.identifier.toLowerCase()));

  return results
    .filter(r => !trackedSet.has(r.username.toLowerCase()))
    .map(r => ({
      username: r.username,
      postCount: Number(r.post_count),
    }));
}

/**
 * Get entity summary for context file generation
 */
export async function getEntitiesSummary(protocolId: string): Promise<{
  delegates: Array<{ displayName: string; identifier: string; bio: string | null }>;
  serviceProviders: Array<{ displayName: string; identifier: string; bio: string | null }>;
  keyUsers: Array<{ displayName: string; identifier: string; bio: string | null }>;
}> {
  const entities = await prisma.protocolEntity.findMany({
    where: { protocolId, isPublished: true },
    select: {
      entityType: true,
      displayName: true,
      identifier: true,
      bio: true,
    },
    orderBy: { displayName: 'asc' },
  });

  return {
    delegates: entities.filter(e => e.entityType === 'DELEGATE'),
    serviceProviders: entities.filter(e => e.entityType === 'SERVICE_PROVIDER'),
    keyUsers: entities.filter(e => e.entityType === 'KEY_USER'),
  };
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Seed initial entities from known service providers
 */
export async function seedServiceProviders(
  protocolId: string,
  providers: Array<{
    identifier: string;
    displayName: string;
    bio?: string;
  }>
): Promise<number> {
  let created = 0;
  
  for (const provider of providers) {
    const existing = await getEntity(protocolId, 'SERVICE_PROVIDER', provider.identifier);
    if (!existing) {
      await upsertEntity(protocolId, 'SERVICE_PROVIDER', provider.identifier, {
        displayName: provider.displayName,
        bio: provider.bio,
        isPublished: true,
      });
      created++;
    }
  }
  
  return created;
}





