import { describe, expect, it } from "vitest";

import type { ClaimExtractionOutput } from "../llm/contracts";

import { ClaimExtractionService } from "./claim-extraction";
import { InMemoryResearchRepository } from "./repository";
import { ResearchDomainService } from "./services";

type ExtractedRelation = ClaimExtractionOutput["relations"][number];

function createTestContext() {
  let id = 0;
  const repository = new InMemoryResearchRepository();
  const domain = new ResearchDomainService(repository, {
    clock: () => new Date("2026-08-18T10:00:00.000Z"),
    idFactory: () => `id-${++id}`,
  });
  const extraction = new ClaimExtractionService(repository, domain);
  const source = domain.createSource({
    name: "Official Gazette",
    domain: "gazette.example",
    sourceType: "GOVERNMENT",
    sourceQuality: "A",
    enabled: true,
    metadata: {},
  });
  const max = domain.createEntity({
    entityType: "PERSON",
    canonicalName: "Max Muster",
    slug: "max-muster",
    metadata: {},
  });
  const anna = domain.createEntity({
    entityType: "PERSON",
    canonicalName: "Anna Beispiel",
    slug: "anna-beispiel",
    metadata: {},
  });
  const party = domain.createEntity({
    entityType: "POLITICAL_PARTY",
    canonicalName: "Example Party",
    slug: "example-party",
    metadata: {},
  });
  const company = domain.createEntity({
    entityType: "COMPANY",
    canonicalName: "Example Arms AG",
    slug: "example-arms-ag",
    metadata: {},
  });
  const event = domain.createEntity({
    entityType: "EVENT",
    canonicalName: "Sicherheitsforum 2026",
    slug: "sicherheitsforum-2026",
    metadata: {},
  });
  const government = domain.createEntity({
    entityType: "GOVERNMENT_BODY",
    canonicalName: "Regierung Exampleland",
    slug: "regierung-exampleland",
    metadata: {},
  });

  function createDocument(extractedText: string) {
    return domain.createDocument({
      sourceId: source.id,
      originalUrl: `https://gazette.example/doc-${id}`,
      canonicalUrl: `https://gazette.example/doc-${id}`,
      title: "Fixture",
      publishedAt: new Date("2026-05-10T00:00:00.000Z"),
      extractedText,
      accessStatus: "PUBLIC",
      extractionStatus: "SUCCESS",
      metadata: {},
    });
  }

  function createCandidate(documentText: string, relation: ExtractedRelation) {
    const document = createDocument(documentText);

    return extraction.createCandidates({
      documentId: document.id,
      relations: [relation],
    }).candidates[0];
  }

  return { repository, createCandidate, max, anna, party, company, event, government };
}

describe("claim extraction evidence validation", () => {
  it("creates a pending review candidate for a positive relationship fixture", () => {
    const { repository, createCandidate, max, party } = createTestContext();

    const candidate = createCandidate("Max Muster ist Mitglied der Example Party.", {
      subject_entity_id: max.id,
      predicate: "MEMBER_OF",
      object_entity_id: party.id,
      connection_class: "DIRECT",
      evidence_text: "Max Muster ist Mitglied der Example Party.",
      confidence: 0.91,
      requires_review: false,
    });

    expect(candidate?.validation).toMatchObject({
      verificationStatus: "PENDING_REVIEW",
      reasons: [],
      evidenceScore: 8,
      startChar: 0,
      endChar: 42,
    });
    expect(candidate?.claim).toMatchObject({
      verificationStatus: "PENDING_REVIEW",
      confidenceScore: 0.91,
      evidenceScore: 8,
      validationNotes: { phase: "phase-7", reasons: [], warnings: [] },
    });
    expect(repository.listClaimEvidenceByClaimId(candidate?.claim?.id ?? "")).toHaveLength(1);
  });

  it("rejects a negated relationship fixture", () => {
    const { createCandidate, max, party } = createTestContext();

    const candidate = createCandidate("Max Muster ist nicht Mitglied der Example Party.", {
      subject_entity_id: max.id,
      predicate: "MEMBER_OF",
      object_entity_id: party.id,
      connection_class: "DIRECT",
      evidence_text: "Max Muster ist nicht Mitglied der Example Party.",
      confidence: 0.77,
      requires_review: true,
    });

    expect(candidate?.claim).toMatchObject({ verificationStatus: "REJECTED" });
    expect(candidate?.validation.reasons).toContain("evidence contains likely negation");
  });

  it("keeps historical relationship fixtures distinguishable", () => {
    const { createCandidate, max, company } = createTestContext();

    const candidate = createCandidate(
      "Von 2018 bis 2020 war Max Muster Verwaltungsrat der Example Arms AG.",
      {
        subject_entity_id: max.id,
        predicate: "BOARD_MEMBER_OF",
        object_entity_id: company.id,
        connection_class: "HISTORICAL",
        valid_from: "2018-01-01",
        valid_to: "2020-12-31",
        evidence_text: "Von 2018 bis 2020 war Max Muster Verwaltungsrat der Example Arms AG.",
        confidence: 0.87,
        requires_review: false,
      },
    );

    expect(candidate?.claim).toMatchObject({
      verificationStatus: "PENDING_REVIEW",
      connectionClass: "HISTORICAL",
      validFrom: "2018-01-01",
      validTo: "2020-12-31",
      evidenceScore: 8,
    });
  });

  it("classifies an official meeting fixture without inventing proximity", () => {
    const { createCandidate, max, government } = createTestContext();

    const candidate = createCandidate(
      "Bundesprasident Max Muster traf die Regierung Exampleland in Bern.",
      {
        subject_entity_id: max.id,
        predicate: "MET_WITH",
        object_entity_id: government.id,
        connection_class: "OFFICIAL",
        evidence_text: "Max Muster traf die Regierung Exampleland in Bern.",
        confidence: 0.86,
        requires_review: false,
      },
    );

    expect(candidate?.claim).toMatchObject({
      verificationStatus: "PENDING_REVIEW",
      predicate: "MET_WITH",
      connectionClass: "OFFICIAL",
    });
  });

  it("creates an event participation candidate only against the event entity", () => {
    const { createCandidate, max, event } = createTestContext();

    const candidate = createCandidate("Max Muster nahm am Sicherheitsforum 2026 teil.", {
      subject_entity_id: max.id,
      predicate: "PARTICIPATED_IN",
      object_entity_id: event.id,
      connection_class: "DIRECT",
      evidence_text: "Max Muster nahm am Sicherheitsforum 2026 teil.",
      confidence: 0.92,
      requires_review: false,
    });

    expect(candidate?.claim).toMatchObject({
      verificationStatus: "PENDING_REVIEW",
      predicate: "PARTICIPATED_IN",
      objectEntityId: event.id,
    });
  });

  it("rejects co-mentions without relationship evidence", () => {
    const { createCandidate, max, company } = createTestContext();

    const candidate = createCandidate(
      "Max Muster und die Example Arms AG wurden im selben Artikel erwahnt.",
      {
        subject_entity_id: max.id,
        predicate: "REPRESENTED",
        object_entity_id: company.id,
        connection_class: "INDIRECT",
        evidence_text: "Max Muster und die Example Arms AG wurden im selben Artikel erwahnt.",
        confidence: 0.62,
        requires_review: true,
      },
    );

    expect(candidate?.claim).toMatchObject({ verificationStatus: "REJECTED" });
    expect(candidate?.validation.reasons).toContain(
      "evidence does not express the proposed relation",
    );
  });

  it("keeps third-party quote fixtures pending with an attribution warning", () => {
    const { createCandidate, max, company } = createTestContext();

    const candidate = createCandidate(
      'Lobbyist Alex sagte: "Max Muster vertrat die Example Arms AG."',
      {
        subject_entity_id: max.id,
        predicate: "REPRESENTED",
        object_entity_id: company.id,
        connection_class: "INDIRECT",
        evidence_text: '"Max Muster vertrat die Example Arms AG."',
        confidence: 0.7,
        requires_review: true,
      },
    );

    expect(candidate?.claim).toMatchObject({ verificationStatus: "PENDING_REVIEW" });
    expect(candidate?.validation.warnings).toContain(
      "evidence appears to rely on a third-party quote or attribution",
    );
    expect(candidate?.validation.evidenceScore).toBe(5);
  });

  it("rejects contradicted claim fixtures", () => {
    const { createCandidate, max, company } = createTestContext();

    const candidate = createCandidate(
      "Max Muster vertrat die Example Arms AG; die Firma dementierte diese Darstellung.",
      {
        subject_entity_id: max.id,
        predicate: "REPRESENTED",
        object_entity_id: company.id,
        connection_class: "INDIRECT",
        evidence_text:
          "Max Muster vertrat die Example Arms AG; die Firma dementierte diese Darstellung.",
        confidence: 0.74,
        requires_review: true,
      },
    );

    expect(candidate?.claim).toMatchObject({ verificationStatus: "REJECTED" });
    expect(candidate?.validation.reasons).toContain("evidence appears contradicted or disputed");
  });

  it("marks ambiguous person fixtures for manual review and lowers the evidence score", () => {
    const { extractionContext } = createAmbiguousContext();

    const candidate = extractionContext.createCandidate(
      "Max Muster ist Mitglied der Example Party.",
      {
        subject_entity_id: extractionContext.max.id,
        predicate: "MEMBER_OF",
        object_entity_id: extractionContext.party.id,
        connection_class: "DIRECT",
        evidence_text: "Max Muster ist Mitglied der Example Party.",
        confidence: 0.91,
        requires_review: false,
      },
    );

    expect(candidate?.claim).toMatchObject({
      verificationStatus: "PENDING_REVIEW",
      evidenceScore: 4,
    });
    expect(candidate?.validation.warnings).toContain("entity resolution is ambiguous");
  });

  it("rejects same-organization fixtures when the evidence names a different person", () => {
    const { createCandidate, max, anna, party } = createTestContext();

    const candidate = createCandidate(
      "Anna Beispiel ist Mitglied der Example Party. Max Muster nahm an der Sitzung teil.",
      {
        subject_entity_id: max.id,
        predicate: "MEMBER_OF",
        object_entity_id: party.id,
        connection_class: "DIRECT",
        evidence_text: "Anna Beispiel ist Mitglied der Example Party.",
        confidence: 0.81,
        requires_review: true,
      },
    );

    expect(anna.canonicalName).toBe("Anna Beispiel");
    expect(candidate?.claim).toMatchObject({ verificationStatus: "REJECTED" });
    expect(candidate?.validation.reasons).toContain(
      "subject entity is not explicit in the evidence context",
    );
  });

  it("rejects claim candidates when evidence text is not in the document", () => {
    const { createCandidate, max, party } = createTestContext();

    const candidate = createCandidate("Max Muster ist Mitglied der Example Party.", {
      subject_entity_id: max.id,
      predicate: "MEMBER_OF",
      object_entity_id: party.id,
      connection_class: "DIRECT",
      evidence_text: "Max Muster ist Prasident der Example Party.",
      confidence: 0.65,
      requires_review: true,
    });

    expect(candidate?.claim).toMatchObject({ verificationStatus: "REJECTED" });
    expect(candidate?.evidence).toBeUndefined();
    expect(candidate?.validation.reasons).toContain("evidence text is not present in the document");
  });
});

function createAmbiguousContext() {
  let id = 0;
  const repository = new InMemoryResearchRepository();
  const domain = new ResearchDomainService(repository, {
    clock: () => new Date("2026-08-18T10:00:00.000Z"),
    idFactory: () => `ambiguous-id-${++id}`,
  });
  const extraction = new ClaimExtractionService(repository, domain);
  const source = domain.createSource({
    name: "Official Gazette",
    sourceType: "GOVERNMENT",
    sourceQuality: "A",
    enabled: true,
    metadata: {},
  });
  const max = domain.createEntity({
    entityType: "PERSON",
    canonicalName: "Max Muster",
    slug: "max-muster",
    metadata: {},
  });
  const party = domain.createEntity({
    entityType: "POLITICAL_PARTY",
    canonicalName: "Example Party",
    slug: "example-party",
    metadata: {},
  });

  function createCandidate(documentText: string, relation: ExtractedRelation) {
    const document = domain.createDocument({
      sourceId: source.id,
      originalUrl: `https://gazette.example/ambiguous-${id}`,
      extractedText: documentText,
      accessStatus: "PUBLIC",
      extractionStatus: "SUCCESS",
      metadata: {},
    });

    return extraction.createCandidates({
      documentId: document.id,
      relations: [relation],
      ambiguousEntityIds: [max.id],
    }).candidates[0];
  }

  return { extractionContext: { createCandidate, max, party } };
}
