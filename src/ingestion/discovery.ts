import type { ResearchRepository } from "../domain/repository";
import type { JsonRecord, UrlCandidateRecord, UrlDiscoveryType } from "../domain/records";
import { ResearchDomainService } from "../domain/services";

import { UrlFetcher } from "./fetcher";
import { canonicalizeUrl } from "./url";

export type DiscoveredUrl = {
  url: string;
  discoveryType: UrlDiscoveryType;
  title?: string;
  publishedAt?: Date;
  lastModifiedAt?: Date;
  metadata?: JsonRecord;
};

export type DiscoveryRunResult = {
  crawlRunId: string;
  candidates: UrlCandidateRecord[];
  urlsDiscovered: number;
  failedItems: number;
  errors: JsonRecord[];
};

export type UrlDiscoveryServiceOptions = {
  repository: ResearchRepository;
  domainService: ResearchDomainService;
  fetcher: UrlFetcher;
  maxSitemapDepth?: number;
};

type ParsedDiscoveryDocument =
  | { kind: "URLS"; urls: DiscoveredUrl[] }
  | { kind: "SITEMAP_INDEX"; sitemaps: Array<{ url: string; lastModifiedAt?: Date }> };

const xmlDecoder = new TextDecoder();

export class UrlDiscoveryService {
  private readonly maxSitemapDepth: number;

  constructor(private readonly options: UrlDiscoveryServiceOptions) {
    this.maxSitemapDepth = options.maxSitemapDepth ?? 3;
  }

  async discover(input: {
    sourceId: string;
    discoveryUrls: string[];
  }): Promise<DiscoveryRunResult> {
    const source = this.options.repository.getSource(input.sourceId);

    if (!source) {
      throw new Error("Cannot discover URLs for an unknown source.");
    }

    const crawlRun = this.options.domainService.createCrawlRun({
      sourceId: source.id,
      startedAt: new Date(),
      status: "RUNNING",
      urlsDiscovered: 0,
      documentsFetched: 0,
      documentsChanged: 0,
      documentsFailed: 0,
      errorLog: [],
    });
    const errors: JsonRecord[] = [];
    const candidates: UrlCandidateRecord[] = [];

    for (const discoveryUrl of input.discoveryUrls) {
      const result = await this.discoverDocument(source.id, crawlRun.id, discoveryUrl, 0);
      candidates.push(...result.candidates);
      errors.push(...result.errors);
    }

    const status = errors.length === 0 ? "SUCCEEDED" : candidates.length > 0 ? "PARTIAL" : "FAILED";

    this.options.domainService.updateCrawlRun(crawlRun.id, {
      finishedAt: new Date(),
      status,
      urlsDiscovered: candidates.length,
      documentsFailed: errors.length,
      errorLog: errors,
    });

    return {
      crawlRunId: crawlRun.id,
      candidates,
      urlsDiscovered: candidates.length,
      failedItems: errors.length,
      errors,
    };
  }

  private async discoverDocument(
    sourceId: string,
    crawlRunId: string,
    discoveryUrl: string,
    depth: number,
  ): Promise<Omit<DiscoveryRunResult, "crawlRunId" | "urlsDiscovered" | "failedItems">> {
    try {
      const fetchResult = await this.options.fetcher.fetch(discoveryUrl);
      const xml = xmlDecoder.decode(fetchResult.body);
      const parsed = parseDiscoveryDocument(xml);

      if (parsed.kind === "URLS") {
        const candidates: UrlCandidateRecord[] = [];
        const errors: JsonRecord[] = [];

        for (const url of parsed.urls) {
          try {
            candidates.push(
              this.options.domainService.createOrUpdateUrlCandidate({
                sourceId,
                crawlRunId,
                discoveryType: url.discoveryType,
                originalUrl: url.url,
                canonicalUrl: canonicalizeUrl(url.url),
                title: url.title,
                publishedAt: url.publishedAt,
                lastModifiedAt: url.lastModifiedAt,
                status: "PENDING",
                metadata: {
                  ...(url.metadata ?? {}),
                  discoveryUrl,
                },
              }),
            );
          } catch (error) {
            errors.push({
              url: url.url,
              reason: error instanceof Error ? error.message : "Unknown candidate error.",
              depth,
            });
          }
        }

        return {
          candidates,
          errors,
        };
      }

      if (depth >= this.maxSitemapDepth) {
        return {
          candidates: [],
          errors: [
            {
              url: discoveryUrl,
              reason: "Sitemap recursion depth exceeded.",
              depth,
            },
          ],
        };
      }

      const candidates: UrlCandidateRecord[] = [];
      const errors: JsonRecord[] = [];

      for (const sitemap of parsed.sitemaps) {
        const result = await this.discoverDocument(sourceId, crawlRunId, sitemap.url, depth + 1);
        candidates.push(...result.candidates);
        errors.push(...result.errors);
      }

      return { candidates, errors };
    } catch (error) {
      return {
        candidates: [],
        errors: [
          {
            url: discoveryUrl,
            reason: error instanceof Error ? error.message : "Unknown discovery error.",
            depth,
          },
        ],
      };
    }
  }
}

export function parseDiscoveryDocument(xml: string): ParsedDiscoveryDocument {
  const normalized = xml.trim();

  if (/<sitemapindex[\s>]/i.test(normalized)) {
    return {
      kind: "SITEMAP_INDEX",
      sitemaps: extractBlocks(normalized, "sitemap").flatMap((block) => {
        const url = tagText(block, "loc");

        if (!url) {
          return [];
        }

        return [
          {
            url,
            lastModifiedAt: parseDate(tagText(block, "lastmod")),
          },
        ];
      }),
    };
  }

  if (/<urlset[\s>]/i.test(normalized)) {
    return {
      kind: "URLS",
      urls: extractBlocks(normalized, "url").flatMap((block) => {
        const url = tagText(block, "loc");

        if (!url) {
          return [];
        }

        const newsBlock = extractBlocks(block, "news:news")[0];
        const newsTitle = newsBlock ? tagText(newsBlock, "news:title") : undefined;
        const publicationDate = newsBlock
          ? parseDate(tagText(newsBlock, "news:publication_date"))
          : undefined;

        return [
          {
            url,
            discoveryType: newsBlock ? "NEWS_SITEMAP" : "SITEMAP",
            title: newsTitle,
            publishedAt: publicationDate,
            lastModifiedAt: parseDate(tagText(block, "lastmod")),
          },
        ];
      }),
    };
  }

  if (/<rss[\s>]/i.test(normalized) || /<rdf:RDF[\s>]/i.test(normalized)) {
    return {
      kind: "URLS",
      urls: extractBlocks(normalized, "item").flatMap((block) => {
        const url = tagText(block, "link") ?? tagText(block, "guid");

        if (!url) {
          return [];
        }

        return [
          {
            url,
            discoveryType: "RSS",
            title: tagText(block, "title"),
            publishedAt: parseDate(tagText(block, "pubDate") ?? tagText(block, "dc:date")),
          },
        ];
      }),
    };
  }

  if (/<feed[\s>]/i.test(normalized)) {
    return {
      kind: "URLS",
      urls: extractBlocks(normalized, "entry").flatMap((block) => {
        const url = atomEntryUrl(block);

        if (!url) {
          return [];
        }

        return [
          {
            url,
            discoveryType: "RSS",
            title: tagText(block, "title"),
            publishedAt: parseDate(tagText(block, "published") ?? tagText(block, "updated")),
          },
        ];
      }),
    };
  }

  throw new Error("Unsupported discovery document format.");
}

function extractBlocks(xml: string, tagName: string): string[] {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<${escapedTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTagName}>`,
    "gi",
  );

  return Array.from(xml.matchAll(pattern), (match) => match[1] ?? "");
}

function tagText(xml: string, tagName: string): string | undefined {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<${escapedTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTagName}>`,
    "i",
  );
  const value = pattern.exec(xml)?.[1];
  return value ? decodeXml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim() : undefined;
}

function atomEntryUrl(xml: string): string | undefined {
  const linkPattern = /<link\s+([^>]*?)\/?>/gi;
  const links = Array.from(xml.matchAll(linkPattern), (match) => match[1] ?? "");
  const alternate = links.find((attributes) => /rel=["']alternate["']/i.test(attributes));
  const selected = alternate ?? links[0];
  const href = selected ? /\bhref=["']([^"']+)["']/i.exec(selected)?.[1] : undefined;
  return href ? decodeXml(href).trim() : undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
