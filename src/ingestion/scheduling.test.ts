import { describe, expect, it } from "vitest";

import { InMemoryResearchRepository } from "../domain/repository";
import { ResearchDomainService } from "../domain/services";

import { UrlDiscoveryService } from "./discovery";
import { UrlFetcher, type FetchLike } from "./fetcher";
import { IngestionSchedulingService } from "./scheduling";
import { InMemoryRawDocumentStorage } from "./storage";
import { UrlIngestionService } from "./url-ingestion";

function response(body: string, url: string, contentType = "text/html"): Response {
  const fetchResponse = new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
  Object.defineProperty(fetchResponse, "url", { value: url });
  return fetchResponse;
}

function createSchedulingContext(fetchImpl: FetchLike, now = "2026-08-18T10:00:00.000Z") {
  let id = 0;
  let currentTime = new Date(now);
  const clock = () => currentTime;
  const repository = new InMemoryResearchRepository();
  const domainService = new ResearchDomainService(repository, {
    clock,
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
  const fetcher = new UrlFetcher({
    fetchImpl,
    maxRetries: 0,
    respectRobots: false,
    requestsPerMinute: 0,
  });
  const discoveryService = new UrlDiscoveryService({
    repository,
    domainService,
    fetcher,
  });
  const urlIngestionService = new UrlIngestionService({
    repository,
    domainService,
    fetcher,
    storage: new InMemoryRawDocumentStorage(),
  });
  const scheduling = new IngestionSchedulingService({
    repository,
    domainService,
    discoveryService,
    urlIngestionService,
    clock,
  });

  return {
    repository,
    domainService,
    source,
    scheduling,
    urlIngestionService,
    setClock: (value: string) => {
      currentTime = new Date(value);
    },
  };
}

describe("ingestion scheduling", () => {
  it("runs due scheduled crawl configuration and advances the next run time", async () => {
    const context = createSchedulingContext(async (url) =>
      response(
        `
          <rss>
            <channel>
              <item><link>https://example.com/story</link></item>
            </channel>
          </rss>
        `,
        url,
        "application/rss+xml",
      ),
    );
    const schedule = context.domainService.createCrawlSchedule({
      sourceId: context.source.id,
      frequency: "DAILY",
      discoveryUrls: ["https://example.com/feed.xml"],
      nextRunAt: new Date("2026-08-18T09:00:00.000Z"),
      status: "ACTIVE",
      metadata: {},
    });

    const results = await context.scheduling.runDueCrawlSchedules();

    expect(results).toEqual([
      expect.objectContaining({
        crawlRunId: expect.any(String),
        urlsDiscovered: 1,
        failedItems: 0,
      }),
    ]);
    expect(context.repository.getCrawlSchedule(schedule.id)).toMatchObject({
      lastRunAt: new Date("2026-08-18T10:00:00.000Z"),
      nextRunAt: new Date("2026-08-19T10:00:00.000Z"),
    });
    expect(context.repository.listUrlCandidates()).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://example.com/story",
        status: "PENDING",
      }),
    ]);
  });

  it("keeps failed fetch jobs retryable until max attempts are exhausted", async () => {
    const context = createSchedulingContext(async () => {
      throw new Error("network unavailable");
    });
    const candidate = context.domainService.createOrUpdateUrlCandidate({
      sourceId: context.source.id,
      discoveryType: "MANUAL",
      originalUrl: "https://example.com/story",
      canonicalUrl: "https://example.com/story",
      status: "PENDING",
      metadata: {},
    });
    const job = context.domainService.createOrReuseUrlCandidateJob(candidate.id, "FETCH_URL", {
      maxAttempts: 2,
      scheduledAt: new Date("2026-08-18T10:00:00.000Z"),
    });

    const firstAttempt = await context.scheduling.processDueFetchJobs();
    context.setClock("2026-08-18T10:02:00.000Z");
    const secondAttempt = await context.scheduling.processDueFetchJobs();

    expect(firstAttempt[0]?.job).toMatchObject({
      id: job.id,
      status: "PENDING",
      attempts: 1,
      errorMessage: "network unavailable",
      scheduledAt: new Date("2026-08-18T10:01:00.000Z"),
    });
    expect(secondAttempt[0]?.job).toMatchObject({
      id: job.id,
      status: "FAILED",
      attempts: 2,
      errorMessage: "network unavailable",
    });
    expect(context.repository.getUrlCandidate(candidate.id)).toMatchObject({ status: "FAILED" });
  });

  it("skips LLM analysis and extraction jobs when the content hash is unchanged", async () => {
    const context = createSchedulingContext(async (url) => response("same content", url));
    await context.urlIngestionService.importUrl({
      sourceId: context.source.id,
      url: "https://example.com/story",
    });
    const candidate = context.domainService.createOrUpdateUrlCandidate({
      sourceId: context.source.id,
      discoveryType: "MANUAL",
      originalUrl: "https://example.com/story?utm_source=feed",
      canonicalUrl: "https://example.com/story",
      status: "PENDING",
      metadata: {},
    });

    context.scheduling.createFetchJobsForPendingCandidates();
    const results = await context.scheduling.processDueFetchJobs();

    expect(results[0]).toMatchObject({
      outcome: "UNCHANGED",
      extractionJob: undefined,
      analysisJob: undefined,
    });
    expect(results[0]?.job).toMatchObject({
      status: "SKIPPED",
      metadata: expect.objectContaining({ llmAnalysisSkipped: true }),
    });
    expect(context.repository.getUrlCandidate(candidate.id)).toMatchObject({
      status: "SKIPPED",
      metadata: expect.objectContaining({ unchanged: true }),
    });
    expect(context.repository.listIngestionJobs()).toHaveLength(1);
  });

  it("queues extraction and analysis jobs when a canonical URL has changed content", async () => {
    let body = "version one";
    const context = createSchedulingContext(async (url) => response(body, url));
    await context.urlIngestionService.importUrl({
      sourceId: context.source.id,
      url: "https://example.com/story",
    });
    body = "version two";
    context.domainService.createOrUpdateUrlCandidate({
      sourceId: context.source.id,
      discoveryType: "MANUAL",
      originalUrl: "https://example.com/story",
      canonicalUrl: "https://example.com/story",
      status: "PENDING",
      metadata: {},
    });

    context.scheduling.createFetchJobsForPendingCandidates();
    const results = await context.scheduling.processDueFetchJobs();
    const jobs = context.repository.listIngestionJobs();

    expect(results[0]?.outcome).toBe("CREATED_NEW_VERSION");
    expect(context.repository.listDocuments()).toHaveLength(2);
    expect(jobs.map((job) => job.jobKind)).toEqual([
      "FETCH_URL",
      "EXTRACT_DOCUMENT",
      "ANALYZE_DOCUMENT",
    ]);
    expect(jobs.slice(1)).toEqual([
      expect.objectContaining({
        documentId: results[0]?.extractionJob?.documentId,
        status: "PENDING",
      }),
      expect.objectContaining({
        documentId: results[0]?.analysisJob?.documentId,
        status: "PENDING",
      }),
    ]);
  });

  it("does not duplicate active fetch jobs or reprocess completed jobs", async () => {
    const context = createSchedulingContext(async (url) => response("new content", url));
    context.domainService.createOrUpdateUrlCandidate({
      sourceId: context.source.id,
      discoveryType: "MANUAL",
      originalUrl: "https://example.com/story",
      canonicalUrl: "https://example.com/story",
      status: "PENDING",
      metadata: {},
    });

    const firstBatch = context.scheduling.createFetchJobsForPendingCandidates();
    const secondBatch = context.scheduling.createFetchJobsForPendingCandidates();
    await context.scheduling.processDueFetchJobs();
    const afterCompletion = await context.scheduling.processDueFetchJobs();

    expect(firstBatch).toHaveLength(1);
    expect(secondBatch).toHaveLength(1);
    expect(secondBatch[0]?.id).toBe(firstBatch[0]?.id);
    expect(afterCompletion).toEqual([]);
    expect(context.repository.listDocuments()).toHaveLength(1);
    expect(context.repository.listIngestionJobs()).toHaveLength(3);
  });
});
