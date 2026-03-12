import { z } from "zod";

export const secretModeSchema = z.union([z.literal("api"), z.literal("cli")]);

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
  version: z.string().optional()
});

export const singleSourceSecretRequestSchema = secretRequestBaseSchema.extend({
  source: secretSourceSchema,
  mode: secretModeSchema.optional()
});

export const fallbackSecretRequestSchema = secretRequestBaseSchema.extend({
  sources: z
    .array(
      z.object({
        source: secretSourceSchema,
        mode: secretModeSchema.optional()
      })
    )
    .min(1)
});

export const secretRequestSchema = z.union([
  singleSourceSecretRequestSchema,
  fallbackSecretRequestSchema
]);

export function parseSecretRequest(input: unknown) {
  return secretRequestSchema.parse(input);
}
