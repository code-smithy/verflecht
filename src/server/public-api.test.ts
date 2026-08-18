import { describe, expect, it } from "vitest";

import { PublicGraphService } from "../domain/public-graph";
import { InMemoryResearchRepository } from "../domain/repository";
import { ResearchDomainService } from "../domain/services";

import {
  getPublicClaimHandlerResult,
  getPublicEntityHandlerResult,
  getPublicGraphHandlerResult,
  parsePublicGraphFilters,
} from "./public-api";

function createApiContext() {
  let id = 0;
  const repository = new InMemoryResearchRepository();
  const domain = new ResearchDomainService(repository, {
    clock: () => new Date("2026-08-18T10:00:00.000Z"),
    idFactory: () => `id-${++id}`,
  });
  const api = new PublicGraphService(repository);
  const person = domain.createEntity({
    entityType: "PERSON",
    canonicalName: "Jane Example",
    slug: "jane-example",
    metadata: { privateNote: "hidden" },
  });
  const party = domain.createEntity({
    entityType: "POLITICAL_PARTY",
    canonicalName: "Example Party",
    slug: "example-party",
    metadata: {},
  });
  const source = domain.createSource({
    name: "Parliament Register",
    sourceType: "PARLIAMENT",
    sourceQuality: "A",
    enabled: true,
    metadata: { crawlerCredentialReference: "hidden" },
  });
  const document = domain.createDocument({
    sourceId: source.id,
    originalUrl: "https://parliament.example/jane",
    title: "Jane Example profile",
    publisher: "Parliament",
    rawStoragePath: "private/raw.html",
    extractedText: "Jane Example is a member of Example Party.",
    accessStatus: "PUBLIC",
    extractionStatus: "SUCCESS",
    metadata: {},
  });
  const claim = domain.createClaim({
    subjectEntityId: person.id,
    predicate: "MEMBER_OF",
    objectEntityId: party.id,
    connectionClass: "DIRECT",
    verificationStatus: "PENDING_REVIEW",
    createdBy: "llm",
  });

  domain.addClaimEvidence({
    claimId: claim.id,
    documentId: document.id,
    evidenceText: "Jane Example is a member of Example Party.",
  });

  return {
    api,
    person,
    claim: domain.verifyClaim(claim.id, { actorId: "reviewer-1" }),
  };
}

describe("public API handlers", () => {
  it("parses graph filters from public query parameters", () => {
    const result = parsePublicGraphFilters(
      new URLSearchParams(
        "entity_type=PERSON&predicate=MEMBER_OF&connection_class=DIRECT&topic=ENERGY&person=jane-example&organisation=Example%20Party&date_from=2024-01-01&date_to=2024-12-31&include_historical=false",
      ),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        entityType: "PERSON",
        predicate: "MEMBER_OF",
        connectionClass: "DIRECT",
        topic: "ENERGY",
        person: "jane-example",
        organization: "Example Party",
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
        includeHistorical: false,
      },
    });
  });

  it("rejects invalid graph filters before querying data", () => {
    const { api } = createApiContext();
    const result = getPublicGraphHandlerResult(
      "https://verflecht.example/api/graph?predicate=INVENTED&include_historical=maybe",
      api,
    );

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: "Invalid public graph filters.",
      details: [
        expect.stringContaining("predicate must be one of"),
        "include_historical must be true or false.",
      ],
    });
  });

  it("returns sanitized public graph responses", () => {
    const { api } = createApiContext();
    const result = getPublicGraphHandlerResult("https://verflecht.example/api/graph", api);

    expect(result.status).toBe(200);
    if (result.status !== 200) {
      throw new Error("Expected graph handler to return a public graph.");
    }
    expect(result.body.edges).toHaveLength(1);
    expect(result.body.edges[0]).not.toHaveProperty("createdBy");
    expect(result.body.edges[0].evidence[0].document).not.toHaveProperty("rawStoragePath");
    expect(result.body.nodes[0]).not.toHaveProperty("metadata");
  });

  it("returns entity and claim details only when they are public", () => {
    const { api, person, claim } = createApiContext();

    expect(getPublicEntityHandlerResult(person.id, api)).toMatchObject({
      status: 200,
      body: {
        entity: { canonicalName: "Jane Example" },
        claims: [expect.objectContaining({ id: claim.id })],
      },
    });
    expect(getPublicClaimHandlerResult(claim.id, api)).toMatchObject({
      status: 200,
      body: {
        id: claim.id,
        verificationStatus: "VERIFIED",
        subject: { canonicalName: "Jane Example" },
      },
    });
    expect(getPublicEntityHandlerResult("missing", api)).toEqual({
      status: 404,
      body: { error: "Public entity not found." },
    });
    expect(getPublicClaimHandlerResult("missing", api)).toEqual({
      status: 404,
      body: { error: "Public claim not found." },
    });
  });
});
