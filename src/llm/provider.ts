import { createHash, randomUUID } from "node:crypto";
import { ZodError } from "zod";

import type { ResearchRepository } from "../domain/repository";
import type { ClaimRecord, DocumentRecord, JsonRecord, LlmRunRecord } from "../domain/records";

import {
  claimExtractionSchemaVersion,
  claimValidationSchemaVersion,
  entityExtractionSchemaVersion,
  entityResolutionSchemaVersion,
  parseClaimExtractionOutput,
  parseClaimValidationOutput,
  parseEntityExtractionOutput,
  parseEntityResolutionOutput,
  type ClaimExtractionOutput,
  type ClaimValidationOutput,
  type EntityExtractionOutput,
  type EntityResolutionOutput,
} from "./contracts";

export type LlmOperation =
  "extractEntities" | "resolveEntityCandidates" | "extractClaims" | "validateClaim";

export type LlmProviderMetadata = {
  provider: string;
  model: string;
  temperature: number;
};

export type LlmPromptContract = {
  promptVersion: string;
};

export type EntityExtractionInput = {
  document: Pick<
    DocumentRecord,
    "id" | "title" | "publisher" | "publishedAt" | "language" | "extractedText"
  >;
};

export type EntityResolutionInput = {
  documentId?: string;
  entities: EntityExtractionOutput["entities"];
  knownEntities: Array<{
    id: string;
    canonicalName: string;
    entityType: string;
    metadata?: JsonRecord;
  }>;
};

export type ClaimExtractionInput = {
  document: Pick<DocumentRecord, "id" | "title" | "extractedText">;
  resolvedEntityIds: string[];
};

export type ClaimValidationInput = {
  document: Pick<DocumentRecord, "id" | "extractedText">;
  claim: Pick<
    ClaimRecord,
    | "id"
    | "subjectEntityId"
    | "predicate"
    | "objectEntityId"
    | "connectionClass"
    | "validFrom"
    | "validTo"
  >;
  evidenceText: string;
};

export type LlmProvider = LlmProviderMetadata & {
  extractEntities(input: EntityExtractionInput): Promise<unknown>;
  resolveEntityCandidates(input: EntityResolutionInput): Promise<unknown>;
  extractClaims(input: ClaimExtractionInput): Promise<unknown>;
  validateClaim(input: ClaimValidationInput): Promise<unknown>;
};

export type LlmServiceOptions = {
  repository: ResearchRepository;
  provider: LlmProvider;
  promptVersion: string;
  clock?: () => Date;
  idFactory?: () => string;
};

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function zodErrorMessage(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

function inputMetadata(input: unknown): {
  documentId?: string;
  claimId?: string;
  textLength?: number;
} {
  if (input && typeof input === "object" && "document" in input) {
    const payload = input as {
      document?: { id?: unknown; extractedText?: unknown };
      claim?: { id?: unknown };
    };

    return {
      documentId: typeof payload.document?.id === "string" ? payload.document.id : undefined,
      claimId: typeof payload.claim?.id === "string" ? payload.claim.id : undefined,
      textLength:
        typeof payload.document?.extractedText === "string"
          ? payload.document.extractedText.length
          : undefined,
    };
  }

  if (input && typeof input === "object" && "documentId" in input) {
    const payload = input as { documentId?: unknown };

    return { documentId: typeof payload.documentId === "string" ? payload.documentId : undefined };
  }

  return {};
}

function outputSummary(output: unknown): JsonRecord {
  if (output && typeof output === "object") {
    if ("entities" in output && Array.isArray((output as { entities?: unknown }).entities)) {
      return { entityCount: (output as { entities: unknown[] }).entities.length };
    }

    if (
      "resolutions" in output &&
      Array.isArray((output as { resolutions?: unknown }).resolutions)
    ) {
      return { resolutionCount: (output as { resolutions: unknown[] }).resolutions.length };
    }

    if ("relations" in output && Array.isArray((output as { relations?: unknown }).relations)) {
      return { relationCount: (output as { relations: unknown[] }).relations.length };
    }

    if ("result" in output) {
      return { result: String((output as { result: unknown }).result) };
    }
  }

  return {};
}

export class LlmExtractionService {
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly options: LlmServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  extractEntities(input: EntityExtractionInput): Promise<EntityExtractionOutput> {
    return this.runProviderCall(
      "extractEntities",
      entityExtractionSchemaVersion,
      input,
      () => this.options.provider.extractEntities(input),
      parseEntityExtractionOutput,
    );
  }

  resolveEntityCandidates(input: EntityResolutionInput): Promise<EntityResolutionOutput> {
    return this.runProviderCall(
      "resolveEntityCandidates",
      entityResolutionSchemaVersion,
      input,
      () => this.options.provider.resolveEntityCandidates(input),
      parseEntityResolutionOutput,
    );
  }

  extractClaims(input: ClaimExtractionInput): Promise<ClaimExtractionOutput> {
    return this.runProviderCall(
      "extractClaims",
      claimExtractionSchemaVersion,
      input,
      () => this.options.provider.extractClaims(input),
      parseClaimExtractionOutput,
    );
  }

  validateClaim(input: ClaimValidationInput): Promise<ClaimValidationOutput> {
    return this.runProviderCall(
      "validateClaim",
      claimValidationSchemaVersion,
      input,
      () => this.options.provider.validateClaim(input),
      parseClaimValidationOutput,
    );
  }

  private async runProviderCall<T>(
    operation: LlmOperation,
    schemaVersion: string,
    input: unknown,
    callProvider: () => Promise<unknown>,
    parseOutput: (output: unknown) => T,
  ): Promise<T> {
    const metadata = inputMetadata(input);
    const baseRun = {
      documentId: metadata.documentId,
      claimId: metadata.claimId,
      operation,
      provider: this.options.provider.provider,
      model: this.options.provider.model,
      promptVersion: this.options.promptVersion,
      schemaVersion,
      temperature: this.options.provider.temperature,
      inputHash: sha256Json(input),
    };

    try {
      const rawOutput = await callProvider();
      const parsed = parseOutput(rawOutput);

      this.persistRun({
        ...baseRun,
        output: outputSummary(parsed),
        status: "SUCCEEDED",
        metadata: { input: metadata },
      });

      return parsed;
    } catch (error) {
      const errorMessage = error instanceof ZodError ? zodErrorMessage(error) : String(error);

      this.persistRun({
        ...baseRun,
        status: "FAILED",
        errorMessage,
        metadata: { input: metadata },
      });

      throw error;
    }
  }

  private persistRun(draft: Omit<LlmRunRecord, "id" | "createdAt">): LlmRunRecord {
    return this.options.repository.createLlmRun({
      ...draft,
      id: this.idFactory(),
      createdAt: this.clock(),
    });
  }
}
