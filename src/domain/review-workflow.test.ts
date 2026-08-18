import { describe, expect, it } from "vitest";

import { PublicGraphService } from "./public-graph";
import { InMemoryResearchRepository } from "./repository";
import { ReviewWorkflowService } from "./review-workflow";
import { ResearchDomainService } from "./services";

function createReviewContext() {
  let id = 0;
  const clock = () => new Date("2026-08-18T10:00:00.000Z");
  const idFactory = () => `id-${++id}`;
  const repository = new InMemoryResearchRepository();
  const domain = new ResearchDomainService(repository, { clock, idFactory });
  const review = new ReviewWorkflowService(repository, domain, { clock, idFactory });
  const graph = new PublicGraphService(repository);

  const person = domain.createEntity({
    entityType: "PERSON",
    canonicalName: "Jane Example",
    slug: "jane-example",
    metadata: { party: "Example Party", canton: "ZH" },
  });
  const party = domain.createEntity({
    entityType: "POLITICAL_PARTY",
    canonicalName: "Example Party",
    slug: "example-party",
    metadata: {},
  });
  const source = domain.createSource({
    name: "Parliament Register",
    domain: "parliament.example",
    sourceType: "PARLIAMENT",
    sourceQuality: "A",
    enabled: true,
    metadata: {},
  });
  const document = domain.createDocument({
    sourceId: source.id,
    originalUrl: "https://parliament.example/jane?utm_source=test",
    canonicalUrl: "https://parliament.example/jane",
    title: "Jane Example profile",
    publisher: "Parliament",
    publishedAt: new Date("2026-08-17T08:00:00.000Z"),
    extractedText: "Jane Example is a member of Example Party.",
    accessStatus: "PUBLIC",
    extractionStatus: "SUCCESS",
    metadata: {},
  });

  function createPendingClaim(predicate: "MEMBER_OF" | "PRESIDENT_OF" = "MEMBER_OF") {
    const claim = domain.createClaim({
      subjectEntityId: person.id,
      predicate,
      objectEntityId: party.id,
      connectionClass: "DIRECT",
      confidenceScore: 0.91,
      evidenceScore: 8,
      validationNotes: { reasons: [], warnings: [] },
      verificationStatus: "PENDING_REVIEW",
      createdBy: "llm",
    });

    domain.addClaimEvidence({
      claimId: claim.id,
      documentId: document.id,
      evidenceText: "Jane Example is a member of Example Party.",
      contextBefore: "Official profile:",
      contextAfter: "Updated in 2026.",
      startChar: 0,
      endChar: 42,
    });
    review.queueClaimForReview(claim.id, {
      reason: "LLM candidate requires human verification.",
      payload: { extractionRunId: "run-1" },
    });

    return claim;
  }

  return { repository, domain, review, graph, person, party, source, document, createPendingClaim };
}

describe("review workflow", () => {
  it("projects claim candidates with evidence, source, scores, and entity resolution context", () => {
    const { repository, review, person, document, createPendingClaim } = createReviewContext();
    const claim = createPendingClaim();
    const task = repository.createEntityResolutionTask({
      id: "resolution-task-1",
      documentId: document.id,
      localId: "e1",
      mentionText: "Jane Example",
      entityType: "PERSON",
      status: "AUTO_RESOLVED",
      selectedEntityId: person.id,
      payload: { evidence: "Jane Example" },
      createdAt: new Date("2026-08-18T10:00:00.000Z"),
      updatedAt: new Date("2026-08-18T10:00:00.000Z"),
    });
    repository.createEntityResolutionCandidate({
      id: "resolution-candidate-1",
      taskId: task.id,
      candidateEntityId: person.id,
      score: 0.93,
      signals: ["exact canonical name"],
      createdAt: new Date("2026-08-18T10:00:00.000Z"),
    });

    const [item] = review.listReviewItems();

    expect(item).toMatchObject({
      claim: {
        id: claim.id,
        predicate: "MEMBER_OF",
        confidenceScore: 0.91,
        evidenceScore: 8,
      },
      subject: { canonicalName: "Jane Example" },
      object: { canonicalName: "Example Party" },
      llmConfidence: 0.91,
      evidenceScore: 8,
      sourceQualities: ["A"],
      evidence: [
        {
          evidence: {
            evidenceText: "Jane Example is a member of Example Party.",
            contextBefore: "Official profile:",
            contextAfter: "Updated in 2026.",
          },
          document: {
            canonicalUrl: "https://parliament.example/jane",
            publisher: "Parliament",
            publishedAt: new Date("2026-08-17T08:00:00.000Z"),
          },
          source: {
            name: "Parliament Register",
            sourceQuality: "A",
          },
        },
      ],
      entityResolution: [
        {
          task: { mentionText: "Jane Example", status: "AUTO_RESOLVED" },
          candidates: [
            {
              candidate: { score: 0.93, signals: ["exact canonical name"] },
              entity: { id: person.id },
            },
          ],
        },
      ],
    });
  });

  it("verifies a queued claim, resolves the queue item, writes audit, and publishes it", () => {
    const { repository, review, graph, createPendingClaim } = createReviewContext();
    const claim = createPendingClaim();

    review.verifyClaim(claim.id, { actorId: "reviewer-1" }, "Evidence matches the source.");

    expect(repository.getClaim(claim.id)).toMatchObject({
      verificationStatus: "VERIFIED",
      reviewedBy: "reviewer-1",
    });
    expect(repository.listReviewQueueItemsByClaimId(claim.id)[0]).toMatchObject({
      status: "RESOLVED",
      reviewerNotes: "Evidence matches the source.",
    });
    expect(repository.listAuditLogs()).toEqual([
      expect.objectContaining({ action: "CLAIM_VERIFIED", actorId: "reviewer-1" }),
    ]);
    expect(graph.getPublicGraph().edges).toHaveLength(1);
  });

  it("rejects and disputes claims without exposing them in the public graph", () => {
    const { repository, review, graph, createPendingClaim } = createReviewContext();
    const rejected = createPendingClaim("MEMBER_OF");
    const disputed = createPendingClaim("PRESIDENT_OF");

    review.rejectClaim(rejected.id, { actorId: "reviewer-1" });
    review.markClaimDisputed(disputed.id, { actorId: "reviewer-1" });

    expect(repository.getClaim(rejected.id)).toMatchObject({ verificationStatus: "REJECTED" });
    expect(repository.getClaim(disputed.id)).toMatchObject({ verificationStatus: "DISPUTED" });
    expect(repository.listAuditLogs().map((entry) => entry.action)).toEqual([
      "CLAIM_REJECTED",
      "CLAIM_DISPUTED",
    ]);
    expect(graph.getPublicGraph().edges).toHaveLength(0);
  });

  it("edits verified claims by superseding the original and publishing the reviewed replacement", () => {
    const { repository, review, graph, person, party, document, createPendingClaim } =
      createReviewContext();
    const original = createPendingClaim();
    review.verifyClaim(original.id, { actorId: "reviewer-1" });

    const replacement = review.editVerifiedClaim({
      claimId: original.id,
      actor: { actorId: "reviewer-2" },
      replacement: {
        subjectEntityId: person.id,
        predicate: "PRESIDENT_OF",
        objectEntityId: party.id,
        connectionClass: "HISTORICAL",
        validFrom: "2020-01-01",
        validTo: "2024-12-31",
        createdBy: "reviewer-2",
      },
      evidence: [
        {
          documentId: document.id,
          evidenceText: "Jane Example was president of Example Party from 2020 to 2024.",
        },
      ],
    });

    expect(repository.getClaim(original.id)).toMatchObject({ verificationStatus: "OUTDATED" });
    expect(replacement).toMatchObject({
      verificationStatus: "VERIFIED",
      supersedesClaimId: original.id,
      predicate: "PRESIDENT_OF",
      connectionClass: "HISTORICAL",
    });
    expect(repository.listAuditLogs().map((entry) => entry.action)).toEqual([
      "CLAIM_VERIFIED",
      "CLAIM_OUTDATED",
      "CLAIM_SUPERSEDED",
      "CLAIM_VERIFIED",
    ]);
    expect(graph.getPublicGraph().edges).toEqual([
      expect.objectContaining({
        id: replacement.id,
        predicate: "PRESIDENT_OF",
      }),
    ]);
  });

  it("audits create entity and merge entity review actions", () => {
    const { repository, domain, review, person, party, createPendingClaim } = createReviewContext();
    const duplicate = review.createEntityForReview(
      {
        entityType: "PERSON",
        canonicalName: "Jane Example",
        slug: "jane-example-duplicate",
        metadata: { canton: "ZH" },
      },
      { actorId: "reviewer-1" },
    );
    const claim = domain.createClaim({
      subjectEntityId: duplicate.id,
      predicate: "MEMBER_OF",
      objectEntityId: party.id,
      connectionClass: "DIRECT",
      verificationStatus: "PENDING_REVIEW",
      createdBy: "reviewer-1",
    });

    createPendingClaim();
    review.mergeEntities(duplicate.id, person.id, { actorId: "reviewer-1" });

    expect(repository.getEntity(duplicate.id)).toMatchObject({
      metadata: expect.objectContaining({ mergedIntoEntityId: person.id }),
    });
    expect(repository.getClaim(claim.id)).toMatchObject({ subjectEntityId: person.id });
    expect(repository.listAuditLogs().map((entry) => entry.action)).toEqual([
      "ENTITY_CREATED",
      "ENTITY_MERGED",
    ]);
  });
});
