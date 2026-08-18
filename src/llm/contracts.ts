import { z } from "zod";

import { connectionClasses, entityTypes, relationPredicates } from "../domain/ontology";

const nonEmptyString = z.string().trim().min(1);
const optionalDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Expected YYYY-MM-DD date.")
  .optional();
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

export const entityExtractionSchemaVersion = "entity-extraction.v1";
export const entityResolutionSchemaVersion = "entity-resolution.v1";
export const claimExtractionSchemaVersion = "claim-extraction.v1";
export const claimValidationSchemaVersion = "claim-validation.v1";

export const detectedEntitySchema = z
  .object({
    local_id: nonEmptyString,
    type: z.enum(entityTypes),
    name: nonEmptyString,
    evidence: nonEmptyString,
    aliases: z.array(nonEmptyString).optional().default([]),
    metadata: z.record(z.string(), jsonValue).optional().default({}),
  })
  .strict();

export const entityExtractionOutputSchema = z
  .object({
    entities: z.array(detectedEntitySchema),
  })
  .strict();

export const entityResolutionCandidateSchema = z
  .object({
    entity_id: nonEmptyString,
    score: z.number().min(0).max(1),
    signals: z.array(nonEmptyString).default([]),
  })
  .strict();

export const entityResolutionOutputSchema = z
  .object({
    resolutions: z.array(
      z
        .object({
          local_id: nonEmptyString,
          candidates: z.array(entityResolutionCandidateSchema),
          manual_review_required: z.boolean(),
          reason: nonEmptyString.optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const claimExtractionOutputSchema = z
  .object({
    relations: z.array(
      z
        .object({
          subject_entity_id: nonEmptyString,
          predicate: z.enum(relationPredicates),
          object_entity_id: nonEmptyString.optional(),
          literal_value: jsonValue.optional(),
          connection_class: z.enum(connectionClasses),
          valid_from: optionalDateString,
          valid_to: optionalDateString,
          evidence_text: nonEmptyString,
          confidence: z.number().min(0).max(1),
          requires_review: z.boolean(),
        })
        .strict()
        .refine((relation) => relation.object_entity_id || relation.literal_value !== undefined, {
          message: "A relation needs either object_entity_id or literal_value.",
        }),
    ),
  })
  .strict();

export const claimValidationOutputSchema = z
  .object({
    result: z.enum(["SUPPORTED", "CONTRADICTED", "INSUFFICIENT"]),
    rationale: nonEmptyString.optional(),
  })
  .strict();

export type EntityExtractionOutput = z.infer<typeof entityExtractionOutputSchema>;
export type EntityResolutionOutput = z.infer<typeof entityResolutionOutputSchema>;
export type ClaimExtractionOutput = z.infer<typeof claimExtractionOutputSchema>;
export type ClaimValidationOutput = z.infer<typeof claimValidationOutputSchema>;

export function parseEntityExtractionOutput(output: unknown): EntityExtractionOutput {
  return entityExtractionOutputSchema.parse(output);
}

export function parseEntityResolutionOutput(output: unknown): EntityResolutionOutput {
  return entityResolutionOutputSchema.parse(output);
}

export function parseClaimExtractionOutput(output: unknown): ClaimExtractionOutput {
  return claimExtractionOutputSchema.parse(output);
}

export function parseClaimValidationOutput(output: unknown): ClaimValidationOutput {
  return claimValidationOutputSchema.parse(output);
}
