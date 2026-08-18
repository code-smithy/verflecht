import { describe, expect, it } from "vitest";

import { InMemoryResearchRepository } from "../domain/repository";
import { ResearchDomainService } from "../domain/services";

import { UrlDiscoveryService, parseDiscoveryDocument } from "./discovery";
import { UrlFetcher, type FetchLike } from "./fetcher";

function xmlResponse(body: string, url: string): Response {
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "application/xml" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function createDiscoveryContext(fetchImpl: FetchLike) {
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
  const fetcher = new UrlFetcher({
    fetchImpl,
    maxRetries: 0,
    respectRobots: false,
    requestsPerMinute: 0,
  });
  const discovery = new UrlDiscoveryService({
    repository,
    domainService,
    fetcher,
  });

  return { discovery, repository, source };
}

describe("discovery document parsing", () => {
  it("parses RSS item URLs with titles and publication dates", () => {
    const parsed = parseDiscoveryDocument(`
      <rss>
        <channel>
          <item>
            <title>Story &amp; update</title>
            <link>https://example.com/story?utm_source=feed</link>
            <pubDate>Tue, 18 Aug 2026 08:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `);

    expect(parsed).toEqual({
      kind: "URLS",
      urls: [
        expect.objectContaining({
          url: "https://example.com/story?utm_source=feed",
          discoveryType: "RSS",
          title: "Story & update",
          publishedAt: new Date("2026-08-18T08:00:00.000Z"),
        }),
      ],
    });
  });

  it("parses regular sitemap and news sitemap URL metadata", () => {
    const parsed = parseDiscoveryDocument(`
      <urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
        <url>
          <loc>https://example.com/story</loc>
          <lastmod>2026-08-17</lastmod>
        </url>
        <url>
          <loc>https://example.com/news-story</loc>
          <news:news>
            <news:title>News sitemap story</news:title>
            <news:publication_date>2026-08-18T09:00:00Z</news:publication_date>
          </news:news>
        </url>
      </urlset>
    `);

    expect(parsed).toMatchObject({
      kind: "URLS",
      urls: [
        {
          url: "https://example.com/story",
          discoveryType: "SITEMAP",
          lastModifiedAt: new Date("2026-08-17T00:00:00.000Z"),
        },
        {
          url: "https://example.com/news-story",
          discoveryType: "NEWS_SITEMAP",
          title: "News sitemap story",
          publishedAt: new Date("2026-08-18T09:00:00.000Z"),
        },
      ],
    });
  });
});

describe("URL discovery service", () => {
  it("stores discovered RSS URLs as canonical candidates before fetching documents", async () => {
    const context = createDiscoveryContext(async (url) =>
      xmlResponse(
        `
          <rss>
            <channel>
              <item>
                <title>First story</title>
                <link>https://example.com/story?utm_campaign=test#fragment</link>
              </item>
            </channel>
          </rss>
        `,
        url,
      ),
    );

    const result = await context.discovery.discover({
      sourceId: context.source.id,
      discoveryUrls: ["https://example.com/feed.xml"],
    });

    expect(result).toMatchObject({
      urlsDiscovered: 1,
      failedItems: 0,
    });
    expect(context.repository.listUrlCandidates()).toEqual([
      expect.objectContaining({
        sourceId: context.source.id,
        crawlRunId: result.crawlRunId,
        discoveryType: "RSS",
        originalUrl: "https://example.com/story?utm_campaign=test#fragment",
        canonicalUrl: "https://example.com/story",
        title: "First story",
        status: "PENDING",
      }),
    ]);
    expect(context.repository.getCrawlRun(result.crawlRunId)).toMatchObject({
      status: "SUCCEEDED",
      urlsDiscovered: 1,
      documentsFetched: 0,
      documentsChanged: 0,
      documentsFailed: 0,
      errorLog: [],
    });
  });

  it("deduplicates URL candidates by source and canonical URL", async () => {
    const context = createDiscoveryContext(async (url) =>
      xmlResponse(
        `
          <urlset>
            <url><loc>https://example.com/story?utm_source=a</loc></url>
            <url><loc>https://example.com/story?utm_source=b</loc></url>
          </urlset>
        `,
        url,
      ),
    );

    await context.discovery.discover({
      sourceId: context.source.id,
      discoveryUrls: ["https://example.com/sitemap.xml"],
    });

    expect(context.repository.listUrlCandidates()).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://example.com/story",
        metadata: expect.objectContaining({ discoveryCount: 2 }),
      }),
    ]);
  });

  it("isolates failed sitemap children while keeping successful candidates", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === "https://example.com/sitemap-index.xml") {
        return xmlResponse(
          `
            <sitemapindex>
              <sitemap><loc>https://example.com/sitemap-a.xml</loc></sitemap>
              <sitemap><loc>https://example.com/sitemap-b.xml</loc></sitemap>
            </sitemapindex>
          `,
          url,
        );
      }

      if (url === "https://example.com/sitemap-a.xml") {
        return xmlResponse(
          `
            <urlset>
              <url><loc>https://example.com/a</loc></url>
            </urlset>
          `,
          url,
        );
      }

      throw new Error(`Network failure for ${url}`);
    };
    const context = createDiscoveryContext(fetchImpl);

    const result = await context.discovery.discover({
      sourceId: context.source.id,
      discoveryUrls: ["https://example.com/sitemap-index.xml"],
    });

    expect(result).toMatchObject({
      urlsDiscovered: 1,
      failedItems: 1,
      errors: [expect.objectContaining({ url: "https://example.com/sitemap-b.xml" })],
    });
    expect(context.repository.listUrlCandidates()).toEqual([
      expect.objectContaining({ canonicalUrl: "https://example.com/a" }),
    ]);
    expect(context.repository.getCrawlRun(result.crawlRunId)).toMatchObject({
      status: "PARTIAL",
      urlsDiscovered: 1,
      documentsFailed: 1,
    });
  });

  it("isolates malformed candidate URLs inside an otherwise valid feed", async () => {
    const context = createDiscoveryContext(async (url) =>
      xmlResponse(
        `
          <rss>
            <channel>
              <item><link>https://example.com/valid</link></item>
              <item><link>mailto:invalid@example.com</link></item>
            </channel>
          </rss>
        `,
        url,
      ),
    );

    const result = await context.discovery.discover({
      sourceId: context.source.id,
      discoveryUrls: ["https://example.com/feed.xml"],
    });

    expect(result).toMatchObject({
      urlsDiscovered: 1,
      failedItems: 1,
    });
    expect(context.repository.listUrlCandidates()).toEqual([
      expect.objectContaining({ canonicalUrl: "https://example.com/valid" }),
    ]);
  });
});
