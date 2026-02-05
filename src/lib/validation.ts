/**
 * Response Validation & Backpressure
 * 
 * Ralph-inspired pattern: Validate LLM output before persisting.
 * Catches hallucinations, malformed responses, and quality issues.
 * 
 * Validation levels:
 * 1. Schema validation - Required fields, types
 * 2. Quality checks - Non-empty content, reasonable values
 * 3. Coherence checks - Cross-reference with input data (optional)
 */

import { z } from 'zod';
import { createLogger } from './logger.js';

const log = createLogger('Validation');

// ============================================================================
// Schema Definitions
// ============================================================================

/**
 * Governance analysis response schema
 */
export const GovernanceResponseSchema = z.object({
  governanceSummary: z.string().min(50, 'Governance summary too short (min 50 chars)'),
  entities: z.array(z.object({
    identifier: z.string().min(1),
    activityLevel: z.enum(['HIGHLY_ACTIVE', 'ACTIVE', 'ENGAGED', 'OCCASIONAL']).optional(),
    observation: z.string().min(10, 'Observation too short'),
    observationType: z.enum([
      'DELEGATE_STANCE',
      'DELEGATE_EXPERTISE', 
      'DELEGATE_ACTIVITY',
      'AUTHOR_SENTIMENT',
      'SERVICE_PROVIDER_UPDATE',
    ]),
    confidence: z.number().min(0).max(100).optional(),
  })).optional().default([]),
  maxProcessedPostId: z.number().int().positive().optional(),
  insights: z.array(z.string()).optional().default([]),
});

/**
 * Entity profile response schema
 */
export const EntityProfileResponseSchema = z.object({
  entityType: z.enum(['SERVICE_PROVIDER', 'DELEGATE', 'KEY_USER']),
  displayName: z.string().min(1),
  bio: z.string().min(10, 'Bio too short').max(500, 'Bio too long'),
  profile: z.object({
    overview: z.string().min(50, 'Overview too short'),
    areasOfFocus: z.array(z.string()).min(1),
    keyPositions: z.array(z.object({
      topic: z.string(),
      stance: z.string(),
      quote: z.string().optional(),
      date: z.string().optional(),
    })).optional().default([]),
    communicationStyle: z.string().optional(),
    activityMetrics: z.object({
      postsAnalyzed: z.number().int().nonnegative(),
      firstSeen: z.string().optional(),
      lastSeen: z.string().optional(),
      topTopics: z.array(z.string()).optional(),
    }).optional(),
  }),
  shouldDraft: z.boolean(),
  draftReason: z.string().optional(),
  sourcePostIds: z.array(z.string()).optional().default([]),
});

/**
 * Repo analysis response schema
 */
export const RepoAnalysisResponseSchema = z.object({
  technicalSummary: z.string().min(100, 'Technical summary too short'),
  projectType: z.string(),
  structure: z.object({
    contractsPath: z.string().nullable().optional(),
    interfacesPath: z.string().nullable().optional(),
    testsPath: z.string().nullable().optional(),
    configFiles: z.array(z.string()).optional(),
  }).optional(),
  contracts: z.array(z.object({
    name: z.string(),
    path: z.string(),
    purpose: z.string().optional(),
    sizeBytes: z.number().optional(),
    hasGovernanceFunctions: z.boolean().optional(),
    governanceFunctions: z.array(z.string()).optional(),
    isUpgradeable: z.boolean().optional(),
    upgradePattern: z.string().optional(),
  })).optional().default([]),
  governanceSurface: z.object({
    accessControlPattern: z.string().optional(),
    adminRoles: z.array(z.string()).optional(),
    hasTimelock: z.boolean().optional(),
    keyParameters: z.array(z.object({
      name: z.string(),
      location: z.string().optional(),
      description: z.string().optional(),
    })).optional(),
  }).optional(),
  documentation: z.object({
    hasReadme: z.boolean(),
    readmeSummary: z.string().optional(),
    hasArchitectureDocs: z.boolean().optional(),
    natspecQuality: z.string().optional(),
  }).optional(),
  gaps: z.array(z.string()).optional().default([]),
  sourceDocsToSave: z.array(z.object({
    sourceType: z.string(),
    title: z.string(),
    content: z.string(),
    sourceUrl: z.string().optional(),
  })).optional().default([]),
});

/**
 * Protocol docs response schema
 */
export const ProtocolDocsResponseSchema = z.object({
  page: z.object({
    title: z.string().min(1),
    path: z.string().min(1),
    content: z.string().min(100, 'Page content too short'),
    pageType: z.enum(['overview', 'feature', 'technical', 'governance']),
  }),
  metadata: z.object({
    sourceDocIds: z.array(z.string()).optional(),
    crossReferences: z.array(z.object({
      path: z.string(),
      context: z.string().optional(),
    })).optional(),
    governanceRelevance: z.string().optional(),
    accuracyNotes: z.array(z.string()).optional(),
  }).optional(),
  shouldDraft: z.boolean(),
  draftReason: z.string().optional(),
});

// Map task types to schemas
const SCHEMA_MAP: Record<string, z.ZodSchema> = {
  FORUM_UPDATE: GovernanceResponseSchema,
  GOVERNANCE_SUMMARY: GovernanceResponseSchema,
  ENTITY_PROFILE: EntityProfileResponseSchema,
  REPO_ONBOARD: RepoAnalysisResponseSchema,
  PROTOCOL_DOCS: ProtocolDocsResponseSchema,
};

// ============================================================================
// Validation Functions
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  data?: unknown;
  errors?: string[];
  warnings?: string[];
}

/**
 * Validate a parsed response against its schema
 */
export function validateResponse(
  taskType: string,
  response: unknown
): ValidationResult {
  const schema = SCHEMA_MAP[taskType];
  
  if (!schema) {
    log.warn(`No schema defined for task type: ${taskType}`);
    return { valid: true, data: response, warnings: ['No schema validation available'] };
  }
  
  const result = schema.safeParse(response);
  
  if (result.success) {
    return { valid: true, data: result.data };
  }
  
  // Extract error messages
  const errors = result.error.errors.map(e => 
    `${e.path.join('.')}: ${e.message}`
  );
  
  return { valid: false, errors };
}

/**
 * Quality checks beyond schema validation
 */
export function qualityCheck(
  taskType: string,
  response: unknown,
  context: { postCount?: number; entityIdentifier?: string }
): ValidationResult {
  const warnings: string[] = [];
  
  if (taskType === 'FORUM_UPDATE' || taskType === 'GOVERNANCE_SUMMARY') {
    const data = response as z.infer<typeof GovernanceResponseSchema>;
    
    // Check if summary mentions any posts when we gave it posts
    if (context.postCount && context.postCount > 0) {
      if (!data.governanceSummary || data.governanceSummary.length < 100) {
        warnings.push(`Short summary despite ${context.postCount} posts provided`);
      }
      
      // Warn if no entities extracted from a decent batch
      if (context.postCount > 20 && (!data.entities || data.entities.length === 0)) {
        warnings.push('No entities extracted from substantial post batch');
      }
    }
    
    // Check for placeholder content
    if (data.governanceSummary?.includes('[TODO]') || 
        data.governanceSummary?.includes('[PLACEHOLDER]')) {
      return { 
        valid: false, 
        errors: ['Response contains placeholder content'] 
      };
    }
  }
  
  if (taskType === 'ENTITY_PROFILE') {
    const data = response as z.infer<typeof EntityProfileResponseSchema>;
    
    // Check if the profile actually references the entity
    if (context.entityIdentifier && 
        !data.profile.overview.toLowerCase().includes(context.entityIdentifier.toLowerCase()) &&
        !data.displayName.toLowerCase().includes(context.entityIdentifier.toLowerCase())) {
      warnings.push('Profile overview does not mention the entity identifier');
    }
    
    // Warn on very short profiles
    if (data.profile.overview.length < 200) {
      warnings.push('Profile overview is quite short');
    }
  }
  
  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Combined validation: schema + quality checks
 */
export function validateAndCheck(
  taskType: string,
  response: unknown,
  context: { postCount?: number; entityIdentifier?: string } = {}
): ValidationResult {
  // Step 1: Schema validation
  const schemaResult = validateResponse(taskType, response);
  if (!schemaResult.valid) {
    return schemaResult;
  }
  
  // Step 2: Quality checks
  const qualityResult = qualityCheck(taskType, schemaResult.data, context);
  if (!qualityResult.valid) {
    return qualityResult;
  }
  
  // Merge warnings
  const allWarnings = [
    ...(schemaResult.warnings || []),
    ...(qualityResult.warnings || []),
  ];
  
  return {
    valid: true,
    data: schemaResult.data,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
  };
}

// ============================================================================
// Coherence Verification (Optional Second Pass)
// ============================================================================

/**
 * Build a verification prompt for loop-back validation
 * 
 * This asks Gemini to verify its own output against the input data.
 * Use sparingly - adds latency and token cost.
 */
export function buildVerificationPrompt(
  taskType: string,
  originalContext: Record<string, unknown>,
  generatedResponse: unknown
): string {
  const base = `You are verifying the quality of a generated response.

TASK TYPE: ${taskType}

ORIGINAL INPUT (summary):
- Post count: ${(originalContext.posts as unknown[])?.length ?? 'N/A'}
- Protocol: ${originalContext.protocol ?? 'N/A'}

GENERATED RESPONSE:
${JSON.stringify(generatedResponse, null, 2).slice(0, 5000)}

VERIFICATION CHECKLIST:
1. Does the response accurately reflect the input data?
2. Are there any obvious hallucinations (claims not supported by input)?
3. Is the content coherent and well-structured?
4. Are confidence scores appropriate given the evidence?

Respond with JSON:
{
  "verified": true/false,
  "issues": ["list of issues if any"],
  "confidence": 0-100
}`;

  return base;
}

export type { z };



