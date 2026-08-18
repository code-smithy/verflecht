import type { ResearchRepository } from "../domain/repository";
import type { DocumentRecord, JsonRecord } from "../domain/records";
import { ResearchDomainService } from "../domain/services";

import { UrlFetcher, type UrlFetchResult } from "./fetcher";
import { sha256Hex } from "./hash";
import { buildRawDocumentPath, type RawDocumentStorage } from "./storage";
import { canonicalizeUrl } from "./url";

export type UrlIngestionOutcome = "CREATED" | "CREATED_NEW_VERSION" | "UNCHANGED";

export type UrlIngestionResult = {
  outcome: UrlIngestionOutcome;
  document: DocumentRecord;
  contentHash: string;
  canonicalUrl: string;
};

export type UrlIngestionServiceOptions = {
  repository: ResearchRepository;
  domainService: ResearchDomainService;
  fetcher: UrlFetcher;
  storage: RawDocumentStorage;
};

function documentVersionFor(repository: ResearchRepository, canonicalUrl: string): number {
  return (
    repository.listDocuments().filter((document) => document.canonicalUrl === canonicalUrl).length +
    1
  );
}

function findDocumentByCanonicalHash(
  repository: ResearchRepository,
  canonicalUrl: string,
  contentHash: string,
): DocumentRecord | undefined {
  return repository
    .listDocuments()
    .find(
      (document) => document.canonicalUrl === canonicalUrl && document.contentHash === contentHash,
    );
}

function hasPriorVersion(repository: ResearchRepository, canonicalUrl: string): boolean {
  return repository.listDocuments().some((document) => document.canonicalUrl === canonicalUrl);
}

function documentMetadata(fetchResult: UrlFetchResult, version: number): JsonRecord {
  return {
    documentVersion: version,
    redirectChain: fetchResult.redirectChain,
    finalUrl: fetchResult.finalUrl,
    responseHeaders: fetchResult.headers,
  };
}

export class UrlIngestionService {
  constructor(private readonly options: UrlIngestionServiceOptions) {}

  async importUrl(input: { sourceId: string; url: string }): Promise<UrlIngestionResult> {
    const source = this.options.repository.getSource(input.sourceId);

    if (!source) {
      throw new Error("Cannot ingest a URL for an unknown source.");
    }

    const fetchResult = await this.options.fetcher.fetch(input.url);
    const canonicalUrl = canonicalizeUrl(fetchResult.finalUrl);
    const contentHash = sha256Hex(fetchResult.body);
    const existing = findDocumentByCanonicalHash(
      this.options.repository,
      canonicalUrl,
      contentHash,
    );

    if (existing) {
      return {
        outcome: "UNCHANGED",
        document: existing,
        contentHash,
        canonicalUrl,
      };
    }

    const priorVersionExists = hasPriorVersion(this.options.repository, canonicalUrl);
    const version = documentVersionFor(this.options.repository, canonicalUrl);
    const rawStoragePath = buildRawDocumentPath({
      sourceType: source.sourceType,
      sourceId: source.id,
      canonicalUrl,
      contentHash,
      contentType: fetchResult.contentType,
    });
    const stored = await this.options.storage.putRawDocument({
      path: rawStoragePath,
      body: fetchResult.body,
      contentType: fetchResult.contentType,
      metadata: {
        canonicalUrl,
        originalUrl: fetchResult.originalUrl,
        contentHash,
      },
    });
    const document = this.options.domainService.createDocument({
      sourceId: source.id,
      originalUrl: fetchResult.originalUrl,
      canonicalUrl,
      contentType: fetchResult.contentType,
      rawStoragePath: stored.path,
      contentHash,
      httpStatus: fetchResult.httpStatus,
      accessStatus: fetchResult.accessStatus,
      extractionStatus: fetchResult.extractionStatus,
      metadata: documentMetadata(fetchResult, version),
    });

    return {
      outcome: priorVersionExists ? "CREATED_NEW_VERSION" : "CREATED",
      document,
      contentHash,
      canonicalUrl,
    };
  }
}
