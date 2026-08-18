import { describe, expect, it } from "vitest";

import { InMemoryResearchRepository } from "./repository";
import { ResearchDomainService } from "./services";

function createTestContext() {
  let id = 0;
  const repository = new InMemoryResearchRepository();
  const service = new ResearchDomainService(repository, {
    clock: () => new Date("2026-08-18T10:00:00.000Z"),
    idFactory: () => `id-${++id}`,
  });

  const person = service.createEntity({
    entityType: "PERSON",
    canonicalName: "Jane Example",
    slug: "jane-example",
    metadata: {},
  });
  const party = service.createEntity({
    entityType: "POLITICAL_PARTY",
    canonicalName: "Example Party",
    slug: "example-party",
    metadata: {},
  });
  const source = service.createSource({
    name: "Parliament Register",
    domain: "parliament.example",
    sourceType: "PARLIAMENT",
    sourceQuality: "A",
    enabled: true,
    metadata: { internalNotes: "not public" },
  });
  const document = service.createDocument({
    sourceId: source.id,
    originalUrl: "https://parliament.example/jane",
    canonicalUrl: "https://parliament.example/jane",
    title: "Jane Example profile",
    rawStoragePath: "raw/private/jane.html",
    extractedText: "Jane Example is a member of Example Party.",
    accessStatus: "PUBLIC",
    extractionStatus: "SUCCESS",
    metadata: {},
  });

  return { repository, service, person, party, source, document };
}

describe("research domain services", () => {
  it("verifies a compatible evidence-backed claim and writes an audit log", () => {
    const { repository, service, person, party, document } = createTestContext();
    const claim = service.createClaim({
      subjectEntityId: person.id,
      predicate: "MEMBER_OF",
      objectEntityId: party.id,
      connectionClass: "DIRECT",
      verificationStatus: "PENDING_REVIEW",
      createdBy: "system",
    });

    service.addClaimEvidence({
      claimId: claim.id,
      documentId: document.id,
      evidenceText: "Jane Example is a member of Example Party.",
    });

    const verified = service.verifyClaim(claim.id, { actorId: "reviewer-1" });

    expect(verified).toMatchObject({
      verificationStatus: "VERIFIED",
      reviewedBy: "reviewer-1",
      reviewedAt: new Date("2026-08-18T10:00:00.000Z"),
    });
    expect(repository.listAuditLogs()).toEqual([
      expect.objectContaining({
        action: "CLAIM_VERIFIED",
        actorId: "reviewer-1",
        entityId: claim.id,
        previousValue: expect.objectContaining({ verificationStatus: "PENDING_REVIEW" }),
        newValue: expect.objectContaining({ verificationStatus: "VERIFIED" }),
      }),
    ]);
  });

  it("refuses to verify a claim without evidence", () => {
    const { service, person, party } = createTestContext();
    const claim = service.createClaim({
      subjectEntityId: person.id,
      predicate: "MEMBER_OF",
      objectEntityId: party.id,
      connectionClass: "DIRECT",
      verificationStatus: "PENDING_REVIEW",
      createdBy: "system",
    });

    expect(() => service.verifyClaim(claim.id, { actorId: "reviewer-1" })).toThrow(
      "without evidence",
    );
  });

  it("rejects incompatible relationship shapes before persistence", () => {
    const { service, party, document } = createTestContext();
    const location = service.createEntity({
      entityType: "LOCATION",
      canonicalName: "Bern",
      slug: "bern",
      metadata: {},
    });

    expect(() =>
      service.createClaim({
        subjectEntityId: location.id,
        predicate: "MEMBER_OF",
        objectEntityId: party.id,
        connectionClass: "DIRECT",
        verificationStatus: "PENDING_REVIEW",
        createdBy: "system",
      }),
    ).toThrow("incompatible");

    expect(() =>
      service.addClaimEvidence({
        claimId: "missing",
        documentId: document.id,
        evidenceText: "Bern is a member of Example Party.",
      }),
    ).toThrow("unknown claim");
  });

  it("records reject and dispute reviewer transitions in the audit log", () => {
    const { repository, service, person, party, document } = createTestContext();
    const rejected = service.createClaim({
      subjectEntityId: person.id,
      predicate: "MEMBER_OF",
      objectEntityId: party.id,
      connectionClass: "DIRECT",
      verificationStatus: "PENDING_REVIEW",
      createdBy: "system",
    });
    const disputed = service.createClaim({
      subjectEntityId: person.id,
      predicate: "PRESIDENT_OF",
      objectEntityId: party.id,
      connectionClass: "DIRECT",
      verificationStatus: "PENDING_REVIEW",
      createdBy: "system",
    });

    service.addClaimEvidence({
      claimId: rejected.id,
      documentId: document.id,
      evidenceText: "Jane Example is a member of Example Party.",
    });
    service.addClaimEvidence({
      claimId: disputed.id,
      documentId: document.id,
      evidenceText: "Jane Example is president of Example Party.",
    });

    service.rejectClaim(rejected.id, { actorId: "reviewer-1" });
    service.markClaimDisputed(disputed.id, { actorId: "reviewer-2" });

    expect(repository.listAuditLogs().map((entry) => entry.action)).toEqual([
      "CLAIM_REJECTED",
      "CLAIM_DISPUTED",
    ]);
  });

  it("supersedes verified claims without overwriting the original record", () => {
    const { repository, service, person, party, document } = createTestContext();
    const claim = service.createClaim({
      subjectEntityId: person.id,
      predicate: "MEMBER_OF",
      objectEntityId: party.id,
      connectionClass: "DIRECT",
      verificationStatus: "PENDING_REVIEW",
      createdBy: "system",
    });
    service.addClaimEvidence({
      claimId: claim.id,
      documentId: document.id,
      evidenceText: "Jane Example is a member of Example Party.",
    });
    service.verifyClaim(claim.id, { actorId: "reviewer-1" });

    const replacement = service.supersedeVerifiedClaim(
      claim.id,
      {
        subjectEntityId: person.id,
        predicate: "PRESIDENT_OF",
        objectEntityId: party.id,
        connectionClass: "HISTORICAL",
        validFrom: "2020-01-01",
        validTo: "2024-12-31",
        createdBy: "reviewer-1",
      },
      { actorId: "reviewer-1" },
    );

    expect(repository.getClaim(claim.id)).toMatchObject({ verificationStatus: "OUTDATED" });
    expect(replacement).toMatchObject({
      verificationStatus: "PENDING_REVIEW",
      supersedesClaimId: claim.id,
      predicate: "PRESIDENT_OF",
    });
    expect(repository.listAuditLogs().map((entry) => entry.action)).toEqual([
      "CLAIM_VERIFIED",
      "CLAIM_OUTDATED",
      "CLAIM_SUPERSEDED",
    ]);
  });
});
