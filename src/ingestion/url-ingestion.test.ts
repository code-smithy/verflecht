import { describe, expect, it } from "vitest";

import { InMemoryResearchRepository } from "../domain/repository";
import { ResearchDomainService } from "../domain/services";

import { UrlFetcher, type FetchLike } from "./fetcher";
import { sha256Hex } from "./hash";
import { InMemoryRawDocumentStorage } from "./storage";
import { UrlIngestionService } from "./url-ingestion";

function textResponse(body: string, url: string): Response {
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function createIngestionContext(fetchImpl: FetchLike) {
  let id = 0;
  const repository = new InMemoryResearchRepository();
  const domainService = new ResearchDomainService(repository, {
    clock: () => new Date("2026-08-18T10:00:00.000Z"),
    idFactory: () => `id-${++id}`,
  });
  const source = domainService.createSource({
    name: "Example News",
    domain: "example.com",
    sourceType: "NEWS_ARTICLE",
    sourceQuality: "D",
    enabled: true,
    metadata: {},
  });
  const storage = new InMemoryRawDocumentStorage();
  const fetcher = new UrlFetcher({ fetchImpl, respectRobots: false, requestsPerMinute: 0 });
  const ingestion = new UrlIngestionService({
    repository,
    domainService,
    fetcher,
    storage,
  });

  return { repository, source, storage, ingestion };
}

describe("URL ingestion service", () => {
  it("stores fetched content by SHA-256 hash and creates an immutable document record", async () => {
    const body = "<html><title>Story</title><p>Public article.</p></html>";
    const context = createIngestionContext(async (url) => textResponse(body, url));

    const result = await context.ingestion.importUrl({
      sourceId: context.source.id,
      url: "https://example.com/story?utm_source=newsletter#fragment",
    });

    expect(result.outcome).toBe("CREATED");
    expect(result.canonicalUrl).toBe("https://example.com/story");
    expect(result.contentHash).toBe(sha256Hex(new TextEncoder().encode(body)));
    expect(result.document).toMatchObject({
      originalUrl: "https://example.com/story",
      canonicalUrl: "https://example.com/story",
      contentHash: result.contentHash,
      accessStatus: "PUBLIC",
      extractionStatus: "PENDING",
      httpStatus: 200,
      metadata: expect.objectContaining({ documentVersion: 1 }),
    });
    expect(result.document.rawStoragePath).toContain(result.contentHash);
    expect(context.storage.getObject(result.document.rawStoragePath ?? "")).toBeDefined();
  });

  it("does not create duplicate document versions for unchanged repeated imports", async () => {
    const context = createIngestionContext(async (url) => textResponse("same content", url));

    const first = await context.ingestion.importUrl({
      sourceId: context.source.id,
      url: "https://example.com/story?utm_medium=social",
    });
    const second = await context.ingestion.importUrl({
      sourceId: context.source.id,
      url: "https://example.com/story?fbclid=abc",
    });

    expect(first.outcome).toBe("CREATED");
    expect(second.outcome).toBe("UNCHANGED");
    expect(second.document.id).toBe(first.document.id);
    expect(context.repository.listDocuments()).toHaveLength(1);
  });

  it("creates a new document version when canonical URL content changes", async () => {
    let body = "version one";
    const context = createIngestionContext(async (url) => textResponse(body, url));

    const first = await context.ingestion.importUrl({
      sourceId: context.source.id,
      url: "https://example.com/story",
    });
    body = "version two";
    const second = await context.ingestion.importUrl({
      sourceId: context.source.id,
      url: "https://example.com/story",
    });

    expect(first.outcome).toBe("CREATED");
    expect(second.outcome).toBe("CREATED_NEW_VERSION");
    expect(second.document.id).not.toBe(first.document.id);
    expect(second.document.metadata).toMatchObject({ documentVersion: 2 });
    expect(context.repository.listDocuments()).toHaveLength(2);
  });
});
