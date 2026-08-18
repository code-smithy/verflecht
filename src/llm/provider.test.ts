import { describe, expect, it } from "vitest";

import { InMemoryResearchRepository } from "../domain/repository";
import type { DocumentRecord } from "../domain/records";

import { parseClaimExtractionOutput, parseEntityExtractionOutput } from "./contracts";
import { LlmExtractionService, type LlmProvider } from "./provider";

const document = {
  id: "document-1",
  sourceId: "source-1",
  originalUrl: "https://example.com/story",
  retrievedAt: new Date("2026-08-18T10:00:00.000Z"),
  extractedText: "Nationalrat Max Muster nahm am Sicherheitsforum teil.",
  accessStatus: "PUBLIC",
  extractionStatus: "SUCCESS",
  metadata: {},
  createdAt: new Date("2026-08-18T10:00:00.000Z"),
  updatedAt: new Date("2026-08-18T10:00:00.000Z"),
} satisfies DocumentRecord;

function createProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    provider: "mock",
    model: "mock-model",
    temperature: 0,
    async extractEntities() {
      return {
        entities: [
          {
            local_id: "e1",
            type: "PERSON",
            name: "Max Muster",
            evidence: "Nationalrat Max Muster",
          },
        ],
      };
    },
    async resolveEntityCandidates() {
      return {
        resolutions: [
          {
            local_id: "e1",
            candidates: [{ entity_id: "entity-1", score: 0.91, signals: ["same name"] }],
            manual_review_required: false,
          },
        ],
      };
    },
    async extractClaims() {
      return {
        relations: [
          {
            subject_entity_id: "entity-1",
            predicate: "PARTICIPATED_IN",
            object_entity_id: "entity-2",
            connection_class: "DIRECT",
            valid_from: "2026-05-10",
            valid_to: "2026-05-10",
            evidence_text: "Max Muster nahm am Sicherheitsforum teil.",
            confidence: 0.88,
            requires_review: true,
          },
        ],
      };
    },
    async validateClaim() {
      return { result: "SUPPORTED", rationale: "Evidence directly states participation." };
    },
    ...overrides,
  };
}

function createService(provider: LlmProvider = createProvider()) {
  let id = 0;
  const repository = new InMemoryResearchRepository();
  const service = new LlmExtractionService({
    repository,
    provider,
    promptVersion: "phase-5-test",
    clock: () => new Date("2026-08-18T10:00:00.000Z"),
    idFactory: () => `llm-run-${++id}`,
  });

  return { repository, service };
}

describe("LLM contracts", () => {
  it("accepts structured entity extraction output from the controlled ontology", () => {
    expect(
      parseEntityExtractionOutput({
        entities: [
          {
            local_id: "e1",
            type: "PERSON",
            name: "Max Muster",
            evidence: "Nationalrat Max Muster",
          },
        ],
      }),
    ).toMatchObject({
      entities: [{ local_id: "e1", type: "PERSON", aliases: [], metadata: {} }],
    });
  });

  it("rejects invalid entity extraction output before it can create records", () => {
    expect(() =>
      parseEntityExtractionOutput({
        entities: [{ local_id: "e1", type: "LOBBYIST", name: "Max Muster", evidence: "" }],
      }),
    ).toThrow();
  });

  it("rejects relation predicates outside the ontology", () => {
    expect(() =>
      parseClaimExtractionOutput({
        relations: [
          {
            subject_entity_id: "entity-1",
            predicate: "HAS_RUSSIAN_CONNECTION",
            object_entity_id: "entity-2",
            connection_class: "INDIRECT",
            evidence_text: "Max Muster was mentioned in the article.",
            confidence: 0.7,
            requires_review: true,
          },
        ],
      }),
    ).toThrow();
  });
});

describe("LLM extraction service", () => {
  it("runs mocked providers through the abstraction and logs schema metadata", async () => {
    const { repository, service } = createService();

    const result = await service.extractEntities({ document });

    expect(result.entities).toHaveLength(1);
    expect(repository.listLlmRuns()).toEqual([
      expect.objectContaining({
        operation: "extractEntities",
        provider: "mock",
        model: "mock-model",
        promptVersion: "phase-5-test",
        schemaVersion: "entity-extraction.v1",
        status: "SUCCEEDED",
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        output: { entityCount: 1 },
        metadata: {
          input: { documentId: "document-1", textLength: document.extractedText.length },
        },
      }),
    ]);
  });

  it("logs failed runs without storing full source text", async () => {
    const { repository, service } = createService(
      createProvider({
        async extractEntities() {
          return { entities: [{ local_id: "e1", type: "UNKNOWN", name: "Max", evidence: "Max" }] };
        },
      }),
    );

    await expect(service.extractEntities({ document })).rejects.toThrow();

    const runs = repository.listLlmRuns();

    expect(runs).toEqual([
      expect.objectContaining({
        operation: "extractEntities",
        status: "FAILED",
        errorMessage: expect.stringContaining("type"),
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        metadata: {
          input: { documentId: "document-1", textLength: document.extractedText.length },
        },
      }),
    ]);
    expect(runs[0]?.output).toBeUndefined();
    expect(JSON.stringify(repository.listLlmRuns())).not.toContain(document.extractedText);
  });

  it("validates every provider operation before returning downstream data", async () => {
    const { service } = createService();

    await expect(
      service.resolveEntityCandidates({
        documentId: document.id,
        entities: [
          {
            local_id: "e1",
            type: "PERSON",
            name: "Max Muster",
            evidence: "Max Muster",
            aliases: [],
            metadata: {},
          },
        ],
        knownEntities: [{ id: "entity-1", canonicalName: "Max Muster", entityType: "PERSON" }],
      }),
    ).resolves.toMatchObject({ resolutions: [{ manual_review_required: false }] });

    await expect(
      service.extractClaims({ document, resolvedEntityIds: ["entity-1", "entity-2"] }),
    ).resolves.toMatchObject({ relations: [{ predicate: "PARTICIPATED_IN" }] });

    await expect(
      service.validateClaim({
        document,
        claim: {
          id: "claim-1",
          subjectEntityId: "entity-1",
          predicate: "PARTICIPATED_IN",
          objectEntityId: "entity-2",
          connectionClass: "DIRECT",
        },
        evidenceText: "Max Muster nahm am Sicherheitsforum teil.",
      }),
    ).resolves.toMatchObject({ result: "SUPPORTED" });
  });
});
