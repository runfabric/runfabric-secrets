import { z } from "zod";

export const secretModeSchema = z.union([z.literal("api"), z.literal("cli")]);
export const fallbackStrategySchema = z.union([
  z.literal("sequential"),
  z.literal("weighted"),
  z.literal("parallel")
]);

export const secretParseAsSchema = z.union([
  z.literal("raw"),
  z.literal("string"),
  z.literal("json")
]);

export const secretSourceSchema = z.string();

export const secretMetadataSchema = z.object({
  source: secretSourceSchema,
  mode: z.union([secretModeSchema, z.literal("native")]),
  version: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  ttlMs: z.number().int().nonnegative().optional(),
  raw: z.unknown().optional()
});

export const secretResultSchema = z.object({
  value: z.unknown(),
  metadata: secretMetadataSchema
});

export const secretRequestBaseSchema = z.object({
  key: z.string().min(1),
  parseAs: secretParseAsSchema.optional(),
  required: z.boolean().optional(),
  cacheTtlMs: z.number().int().nonnegative().optional(),
  version: z.string().optional(),
  refreshIntervalMs: z.number().nonnegative().optional()
});

export const fallbackPolicySchema = z.object({
  strategy: fallbackStrategySchema.optional(),
  failFast: z.boolean().optional(),
  failFastOn: z.array(z.string()).optional(),
  retryableErrors: z.array(z.string()).optional(),
  parallelism: z.number().int().positive().optional()
});

export const fallbackSourceConfigSchema = z.object({
  source: secretSourceSchema,
  mode: secretModeSchema.optional(),
  weight: z.number().optional()
});

export const singleSourceSecretRequestSchema = secretRequestBaseSchema.extend({
  source: secretSourceSchema,
  mode: secretModeSchema.optional(),
  signal: z.unknown().optional()
});

export const fallbackSecretRequestSchema = secretRequestBaseSchema.extend({
  sources: z.array(fallbackSourceConfigSchema).min(1),
  fallbackPolicy: fallbackPolicySchema.optional()
});

export const secretRequestSchema = z.union([
  singleSourceSecretRequestSchema,
  fallbackSecretRequestSchema
]);

export function parseSecretRequest(input: unknown) {
  return secretRequestSchema.parse(input);
}
