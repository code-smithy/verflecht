import { describe, expect, it } from "vitest";

import { PublicGraphService } from "./public-graph";
import { InMemoryResearchRepository } from "./repository";
import { ResearchDomainService } from "./services";

function createGraphContext() {
  let id = 0;
  const repository = new InMemoryResearchRepository();
  const service = new ResearchDomainService(repository, {
    clock: () => new Date("2026-08-18T10:00:00.000Z"),
    idFactory: () => `id-${++id}`,
  });
  const graph = new PublicGraphService(repository);

  const person = service.createEntity({
    entityType: "PERSON",
    canonicalName: "Jane Example",
    slug: "jane-example",
    metadata: { privateResearchNote: "hidden" },
  });
  const party = service.createEntity({
    entityType: "POLITICAL_PARTY",
    canonicalName: "Example Party",
    slug: "example-party",
    metadata: {},
  });
  const event = service.createEntity({
    entityType: "EVENT",
    canonicalName: "Example Hearing",
    slug: "example-hearing",
    metadata: {},
  });
  const source = service.createSource({
    name: "Parliament Register",
    domain: "parliament.example",
    sourceType: "PARLIAMENT",
    sourceQuality: "A",
    enabled: true,
    metadata: { crawlerConfiguration: "hidden" },
  });
  const document = service.createDocument({
    sourceId: source.id,
    originalUrl: "https://parliament.example/jane?tracking=1",
    canonicalUrl: "https://parliament.example/jane",
    title: "Jane Example profile",
    publisher: "Parliament",
    publishedAt: new Date("2026-08-17T08:00:00.000Z"),
    rawStoragePath: "raw/private/jane.html",
    extractedText: "Jane Example is a member of Example Party.",
    accessStatus: "PUBLIC",
    extractionStatus: "SUCCESS",
    metadata: { internalExtractorVersion: "hidden" },
  });

  service.createEntityAlias({
    entityId: person.id,
    alias: "J. Example",
    language: "en",
    sourceId: source.id,
  });

  return { repository, service, graph, person, party, event, source, document };
}

function createReviewedClaim(
  context: ReturnType<typeof createGraphContext>,
  options: {
    predicate?: "MEMBER_OF" | "PRESIDENT_OF" | "SPOKE_AT";
    objectEntityId?: string;
    connectionClass?: "DIRECT" | "HISTORICAL" | "OFFICIAL";
    status?: "VERIFIED" | "REJECTED" | "DISPUTED";
    validFrom?: string;
    validTo?: string;
    topics?: string[];
  } = {},
) {
  const predicate = options.predicate ?? "MEMBER_OF";
  const objectEntityId = options.objectEntityId ?? context.party.id;
  const claim = context.service.createClaim({
    subjectEntityId: context.person.id,
    predicate,
    objectEntityId,
    connectionClass: options.connectionClass ?? "DIRECT",
    validFrom: options.validFrom,
    validTo: options.validTo,
    validationNotes: options.topics ? { topics: options.topics } : {},
    verificationStatus: "PENDING_REVIEW",
    createdBy: "system",
  });

  context.service.addClaimEvidence({
    claimId: claim.id,
    documentId: context.document.id,
    evidenceText: `Jane Example ${predicate.toLowerCase()} evidence.`,
    contextBefore: "Before",
    contextAfter: "After",
  });

  if (options.status === "REJECTED") {
    return context.service.rejectClaim(claim.id, { actorId: "reviewer-1" });
  }

  if (options.status === "DISPUTED") {
    return context.service.markClaimDisputed(claim.id, { actorId: "reviewer-1" });
  }

  return context.service.verifyClaim(claim.id, { actorId: "reviewer-1" });
}

describe("public graph projection", () => {
  it("returns only verified source-backed claims and strips internal fields", () => {
    const context = createGraphContext();
    createReviewedClaim(context);
    createReviewedClaim(context, { predicate: "PRESIDENT_OF", status: "REJECTED" });
    createReviewedClaim(context, { predicate: "PRESIDENT_OF", status: "DISPUTED" });

    const projection = context.graph.getPublicGraph();

    expect(projection.edges).toHaveLength(1);
    expect(projection.nodes.map((node) => node.canonicalName).sort()).toEqual([
      "Example Party",
      "Jane Example",
    ]);
    expect(projection.nodes[0]).not.toHaveProperty("metadata");

    const [edge] = projection.edges;
    expect(edge).toMatchObject({
      predicate: "MEMBER_OF",
      subjectEntityId: context.person.id,
      objectEntityId: context.party.id,
    });
    expect(edge).not.toHaveProperty("createdBy");
    expect(edge).not.toHaveProperty("reviewedBy");
    expect(edge.evidence[0]).toMatchObject({
      evidenceText: "Jane Example member_of evidence.",
      contextBefore: "Before",
      contextAfter: "After",
      document: {
        url: "https://parliament.example/jane",
        title: "Jane Example profile",
        accessStatus: "PUBLIC",
      },
      source: {
        name: "Parliament Register",
        sourceType: "PARLIAMENT",
        sourceQuality: "A",
      },
    });
    expect(edge.evidence[0].document).not.toHaveProperty("rawStoragePath");
    expect(edge.evidence[0].document).not.toHaveProperty("extractedText");
    expect(edge.evidence[0].source).not.toHaveProperty("metadata");
    expect(projection).not.toHaveProperty("auditLogs");
    expect(projection).not.toHaveProperty("reviewQueue");
  });

  it("excludes pending, rejected, disputed, and evidence-free claims", () => {
    const context = createGraphContext();
    createReviewedClaim(context);
    createReviewedClaim(context, { predicate: "PRESIDENT_OF", status: "REJECTED" });

    context.service.createClaim({
      subjectEntityId: context.person.id,
      predicate: "PRESIDENT_OF",
      objectEntityId: context.party.id,
      connectionClass: "DIRECT",
      verificationStatus: "PENDING_REVIEW",
      createdBy: "system",
    });

    const projection = context.graph.getPublicGraph();

    expect(projection.edges).toHaveLength(1);
    expect(projection.edges[0].predicate).toBe("MEMBER_OF");
  });

  it("supports predicate, entity, entity type, connection class, and historical filters", () => {
    const context = createGraphContext();
    createReviewedClaim(context);
    createReviewedClaim(context, {
      predicate: "PRESIDENT_OF",
      connectionClass: "HISTORICAL",
    });
    createReviewedClaim(context, {
      predicate: "SPOKE_AT",
      objectEntityId: context.event.id,
      connectionClass: "OFFICIAL",
    });

    expect(context.graph.getPublicGraph({ predicate: "SPOKE_AT" }).edges).toHaveLength(1);
    expect(context.graph.getPublicGraph({ entityId: context.event.id }).edges).toHaveLength(1);
    expect(context.graph.getPublicGraph({ entityType: "POLITICAL_PARTY" }).edges).toHaveLength(2);
    expect(context.graph.getPublicGraph({ connectionClass: "OFFICIAL" }).edges).toHaveLength(1);
    expect(context.graph.getPublicGraph({ includeHistorical: false }).edges).toHaveLength(2);
  });

  it("supports topic, person, organization, and date range filters", () => {
    const context = createGraphContext();
    createReviewedClaim(context, {
      topics: ["ENERGY"],
      validFrom: "2024-01-01",
      validTo: "2024-12-31",
    });
    createReviewedClaim(context, {
      predicate: "PRESIDENT_OF",
      topics: ["SECURITY"],
      validFrom: "2021-01-01",
      validTo: "2021-12-31",
    });

    expect(context.graph.getPublicGraph({ topic: "ENERGY" }).edges).toHaveLength(1);
    expect(context.graph.getPublicGraph({ person: "jane-example" }).edges).toHaveLength(2);
    expect(context.graph.getPublicGraph({ organization: "Example Party" }).edges).toHaveLength(2);
    expect(
      context.graph.getPublicGraph({ dateFrom: "2024-06-01", dateTo: "2024-06-30" }).edges,
    ).toEqual([expect.objectContaining({ predicate: "MEMBER_OF" })]);
  });

  it("projects public entity detail with aliases, connected entities, sources, events, and timeline", () => {
    const context = createGraphContext();
    const direct = createReviewedClaim(context, {
      validFrom: "2024-01-01",
    });
    createReviewedClaim(context, {
      predicate: "SPOKE_AT",
      objectEntityId: context.event.id,
      connectionClass: "OFFICIAL",
      validFrom: "2026-02-15",
      validTo: "2026-02-15",
    });

    const detail = context.graph.getPublicEntityDetail(context.person.id);

    expect(detail).toMatchObject({
      entity: {
        id: context.person.id,
        canonicalName: "Jane Example",
      },
      aliases: [{ alias: "J. Example", language: "en" }],
      claims: [expect.objectContaining({ id: direct.id }), expect.any(Object)],
      connectedEntities: [
        expect.objectContaining({ canonicalName: "Example Hearing" }),
        expect.objectContaining({ canonicalName: "Example Party" }),
      ],
      events: [expect.objectContaining({ canonicalName: "Example Hearing" })],
      sources: [expect.objectContaining({ name: "Parliament Register" })],
      timeline: [
        expect.objectContaining({
          predicate: "MEMBER_OF",
          connectedEntity: expect.objectContaining({ canonicalName: "Example Party" }),
        }),
        expect.objectContaining({
          predicate: "SPOKE_AT",
          connectedEntity: expect.objectContaining({ canonicalName: "Example Hearing" }),
        }),
      ],
    });
    expect(detail?.entity).not.toHaveProperty("metadata");
    expect(detail?.claims[0]).not.toHaveProperty("reviewedBy");
  });

  it("projects public claim detail only for verified source-backed claims", () => {
    const context = createGraphContext();
    const verified = createReviewedClaim(context);
    const rejected = createReviewedClaim(context, {
      predicate: "PRESIDENT_OF",
      status: "REJECTED",
    });

    expect(context.graph.getPublicClaimDetail(verified.id)).toMatchObject({
      id: verified.id,
      verificationStatus: "VERIFIED",
      subject: { canonicalName: "Jane Example" },
      object: { canonicalName: "Example Party" },
      evidence: [expect.objectContaining({ evidenceText: "Jane Example member_of evidence." })],
    });
    expect(context.graph.getPublicClaimDetail(rejected.id)).toBeUndefined();
  });
});
