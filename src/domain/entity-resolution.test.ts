import { describe, expect, it } from "vitest";

import { EntityResolutionService } from "./entity-resolution";
import { InMemoryResearchRepository } from "./repository";
import { ResearchDomainService } from "./services";

function createTestContext() {
  let id = 0;
  const repository = new InMemoryResearchRepository();
  const domain = new ResearchDomainService(repository, {
    clock: () => new Date("2026-08-18T10:00:00.000Z"),
    idFactory: () => `id-${++id}`,
  });
  const resolver = new EntityResolutionService(repository, {
    clock: () => new Date("2026-08-18T10:00:00.000Z"),
    idFactory: () => `resolution-${++id}`,
  });

  return { repository, domain, resolver };
}

describe("entity resolution", () => {
  it("auto-resolves an exact alias match", () => {
    const { domain, resolver } = createTestContext();
    const person = domain.createEntity({
      entityType: "PERSON",
      canonicalName: "Max Muster",
      slug: "max-muster",
      metadata: { party: "Example Party", canton: "ZH" },
    });
    domain.createEntityAlias({
      entityId: person.id,
      alias: "Nationalrat Muster",
      language: "de",
    });

    const result = resolver.resolveMentions({
      documentId: "document-1",
      mentions: [
        {
          localId: "e1",
          entityType: "PERSON",
          name: "Nationalrat Muster",
          evidence: "Nationalrat Muster nahm teil.",
        },
      ],
    });

    expect(result.resolutions).toEqual([
      expect.objectContaining({
        localId: "e1",
        selectedEntityId: person.id,
        manualReviewRequired: false,
        status: "AUTO_RESOLVED",
        candidates: [
          expect.objectContaining({
            entityId: person.id,
            score: 0.9,
            signals: ["exact alias"],
          }),
        ],
      }),
    ]);
    expect(result.reviewTasks).toEqual([]);
  });

  it("routes ambiguous surname matches to manual review", () => {
    const { domain, repository, resolver } = createTestContext();
    const peter = domain.createEntity({
      entityType: "PERSON",
      canonicalName: "Peter Muller",
      slug: "peter-muller",
      metadata: { position: "Nationalrat" },
    });
    const anna = domain.createEntity({
      entityType: "PERSON",
      canonicalName: "Anna Muller",
      slug: "anna-muller",
      metadata: { position: "Nationalrat" },
    });

    const result = resolver.resolveMentions({
      documentId: "document-1",
      mentions: [
        {
          localId: "e1",
          entityType: "PERSON",
          name: "Nationalrat Muller",
          metadata: { position: "Nationalrat" },
        },
      ],
    });

    expect(result.resolutions[0]).toMatchObject({
      manualReviewRequired: true,
      status: "MANUAL_REVIEW",
      reason: "Ambiguous entity candidates require manual review.",
    });
    expect(result.resolutions[0]?.selectedEntityId).toBeUndefined();
    expect(result.resolutions[0]?.candidates.map((candidate) => candidate.entityId)).toEqual([
      anna.id,
      peter.id,
    ]);
    expect(result.reviewTasks).toEqual([
      expect.objectContaining({
        documentId: "document-1",
        localId: "e1",
        mentionText: "Nationalrat Muller",
        status: "MANUAL_REVIEW",
      }),
    ]);
    expect(
      repository.listEntityResolutionCandidatesByTaskId(result.reviewTasks[0]?.id ?? ""),
    ).toHaveLength(2);
  });

  it("uses canton metadata to separate same-name people", () => {
    const { domain, resolver } = createTestContext();
    domain.createEntity({
      entityType: "PERSON",
      canonicalName: "Max Muster",
      slug: "max-muster-be",
      metadata: { canton: "BE" },
    });
    const zurichMax = domain.createEntity({
      entityType: "PERSON",
      canonicalName: "Max Muster",
      slug: "max-muster-zh",
      metadata: { canton: "ZH" },
    });

    const result = resolver.resolveMentions({
      mentions: [
        {
          localId: "e1",
          entityType: "PERSON",
          name: "Max Muster",
          metadata: { canton: "ZH" },
        },
      ],
    });

    expect(result.resolutions[0]).toMatchObject({
      selectedEntityId: zurichMax.id,
      manualReviewRequired: false,
      status: "AUTO_RESOLVED",
    });
    expect(result.resolutions[0]?.candidates[0]).toMatchObject({
      entityId: zurichMax.id,
      score: 0.98,
      signals: ["exact canonical name", "same canton"],
    });
  });

  it("routes below-threshold matches to manual review", () => {
    const { domain, resolver } = createTestContext();
    const company = domain.createEntity({
      entityType: "COMPANY",
      canonicalName: "Example Arms AG",
      slug: "example-arms-ag",
      metadata: {},
    });

    const result = resolver.resolveMentions({
      mentions: [
        {
          localId: "e1",
          entityType: "COMPANY",
          name: "Arms",
        },
      ],
    });

    expect(result.resolutions[0]).toMatchObject({
      manualReviewRequired: true,
      status: "MANUAL_REVIEW",
      reason: "Top candidate is below the automatic resolution threshold.",
      candidates: [
        expect.objectContaining({
          entityId: company.id,
          score: 0.42,
          signals: ["partial name"],
        }),
      ],
    });
    expect(result.resolutions[0]?.selectedEntityId).toBeUndefined();
    expect(result.reviewTasks).toHaveLength(1);
  });

  it("does not automatically merge ambiguous people", () => {
    const { domain, resolver } = createTestContext();
    const first = domain.createEntity({
      entityType: "PERSON",
      canonicalName: "Alex Beispiel",
      slug: "alex-beispiel-1",
      metadata: {},
    });
    const second = domain.createEntity({
      entityType: "PERSON",
      canonicalName: "Alex Beispiel",
      slug: "alex-beispiel-2",
      metadata: {},
    });

    const result = resolver.resolveMentions({
      mentions: [
        {
          localId: "e1",
          entityType: "PERSON",
          name: "Alex Beispiel",
        },
      ],
    });

    expect(result.resolutions[0]).toMatchObject({
      manualReviewRequired: true,
      status: "MANUAL_REVIEW",
      reason: "Ambiguous entity candidates require manual review.",
    });
    expect(result.resolutions[0]?.selectedEntityId).toBeUndefined();
    expect(result.resolutions[0]?.candidates.map((candidate) => candidate.entityId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(result.reviewTasks).toHaveLength(1);
  });
});
