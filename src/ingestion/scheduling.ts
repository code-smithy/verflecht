import type { ResearchRepository } from "../domain/repository";
import type {
  CrawlRunRecord,
  CrawlScheduleRecord,
  IngestionJobRecord,
  JsonRecord,
  UrlCandidateRecord,
} from "../domain/records";
import { ResearchDomainService } from "../domain/services";

import { UrlDiscoveryService } from "./discovery";
import { UrlIngestionService } from "./url-ingestion";

export type ScheduledCrawlResult = {
  schedule: CrawlScheduleRecord;
  crawlRunId: string;
  urlsDiscovered: number;
  failedItems: number;
};

export type FetchJobResult = {
  job: IngestionJobRecord;
  candidate: UrlCandidateRecord;
  outcome: "CREATED" | "CREATED_NEW_VERSION" | "UNCHANGED" | "FAILED";
  extractionJob?: IngestionJobRecord;
  analysisJob?: IngestionJobRecord;
};

export type IngestionSchedulingServiceOptions = {
  repository: ResearchRepository;
  domainService: ResearchDomainService;
  discoveryService: UrlDiscoveryService;
  urlIngestionService: UrlIngestionService;
  clock?: () => Date;
};

export class IngestionSchedulingService {
  private readonly clock: () => Date;

  constructor(private readonly options: IngestionSchedulingServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async runDueCrawlSchedules(): Promise<ScheduledCrawlResult[]> {
    const dueSchedules = this.options.domainService.listDueCrawlSchedules(this.clock());
    const results: ScheduledCrawlResult[] = [];

    for (const schedule of dueSchedules) {
      const result = await this.options.discoveryService.discover({
        sourceId: schedule.sourceId,
        discoveryUrls: schedule.discoveryUrls,
      });

      const updatedSchedule = this.options.domainService.markCrawlScheduleRun(
        schedule.id,
        this.clock(),
      );

      results.push({
        schedule: updatedSchedule,
        crawlRunId: result.crawlRunId,
        urlsDiscovered: result.urlsDiscovered,
        failedItems: result.failedItems,
      });
    }

    return results;
  }

  createFetchJobsForPendingCandidates(input: { crawlRunId?: string } = {}): IngestionJobRecord[] {
    return this.options.repository
      .listUrlCandidates()
      .filter((candidate) => candidate.status === "PENDING")
      .filter((candidate) => !input.crawlRunId || candidate.crawlRunId === input.crawlRunId)
      .map((candidate) =>
        this.options.domainService.createOrReuseUrlCandidateJob(candidate.id, "FETCH_URL", {
          scheduledAt: this.clock(),
          metadata: {
            canonicalUrl: candidate.canonicalUrl,
          },
        }),
      );
  }

  async processDueFetchJobs(limit = Number.POSITIVE_INFINITY): Promise<FetchJobResult[]> {
    const dueJobs = this.options.domainService
      .listDueIngestionJobs("FETCH_URL", this.clock())
      .slice(0, limit);
    const results: FetchJobResult[] = [];

    for (const dueJob of dueJobs) {
      const job = this.options.domainService.startIngestionJob(dueJob.id);
      const candidate = this.getCandidateForJob(job);

      try {
        const ingestion = await this.options.urlIngestionService.importUrl({
          sourceId: candidate.sourceId,
          url: candidate.originalUrl,
        });
        const changed = ingestion.outcome !== "UNCHANGED";
        const completedJob = this.options.domainService.completeIngestionJob(
          job.id,
          {
            outcome: ingestion.outcome,
            documentId: ingestion.document.id,
            contentHash: ingestion.contentHash,
            canonicalUrl: ingestion.canonicalUrl,
            llmAnalysisSkipped: !changed,
          },
          changed ? "SUCCEEDED" : "SKIPPED",
        );

        const extractionJob = changed
          ? this.options.domainService.createOrReuseDocumentJob(
              ingestion.document.id,
              "EXTRACT_DOCUMENT",
              {
                scheduledAt: this.clock(),
                metadata: {
                  trigger: ingestion.outcome,
                  sourceFetchJobId: job.id,
                },
              },
            )
          : undefined;
        const analysisJob = changed
          ? this.options.domainService.createOrReuseDocumentJob(
              ingestion.document.id,
              "ANALYZE_DOCUMENT",
              {
                scheduledAt: this.clock(),
                metadata: {
                  trigger: ingestion.outcome,
                  sourceFetchJobId: job.id,
                  waitsForJobId: extractionJob?.id,
                },
              },
            )
          : undefined;

        this.options.repository.updateUrlCandidate(candidate.id, {
          status: changed ? "FETCHED" : "SKIPPED",
          metadata: {
            ...candidate.metadata,
            lastFetchJobId: job.id,
            lastDocumentId: ingestion.document.id,
            lastContentHash: ingestion.contentHash,
            unchanged: !changed,
          },
          updatedAt: this.clock(),
        });
        this.updateCrawlRunStats(candidate.crawlRunId, changed, false);
        results.push({
          job: completedJob,
          candidate,
          outcome: ingestion.outcome,
          extractionJob,
          analysisJob,
        });
      } catch (error) {
        const failedJob = this.options.domainService.failIngestionJob(
          job.id,
          error instanceof Error ? error.message : "Unknown ingestion error.",
        );

        if (failedJob.status === "FAILED") {
          this.options.repository.updateUrlCandidate(candidate.id, {
            status: "FAILED",
            metadata: {
              ...candidate.metadata,
              lastFetchJobId: job.id,
              lastError: failedJob.errorMessage,
            },
            updatedAt: this.clock(),
          });
          this.updateCrawlRunStats(candidate.crawlRunId, false, true, {
            url: candidate.originalUrl,
            reason: failedJob.errorMessage ?? "Unknown ingestion error.",
          });
        }

        results.push({
          job: failedJob,
          candidate,
          outcome: "FAILED",
        });
      }
    }

    return results;
  }

  private getCandidateForJob(job: IngestionJobRecord): UrlCandidateRecord {
    if (!job.urlCandidateId) {
      throw new Error("FETCH_URL jobs require a URL candidate.");
    }

    const candidate = this.options.repository.getUrlCandidate(job.urlCandidateId);

    if (!candidate) {
      throw new Error("FETCH_URL job references an unknown URL candidate.");
    }

    return candidate;
  }

  private updateCrawlRunStats(
    crawlRunId: string | undefined,
    changed: boolean,
    failed: boolean,
    error?: JsonRecord,
  ): void {
    if (!crawlRunId) {
      return;
    }

    const crawlRun = this.options.repository.getCrawlRun(crawlRunId);

    if (!crawlRun) {
      return;
    }

    this.options.domainService.updateCrawlRun(crawlRunId, {
      documentsFetched: crawlRun.documentsFetched + (failed ? 0 : 1),
      documentsChanged: crawlRun.documentsChanged + (changed ? 1 : 0),
      documentsFailed: crawlRun.documentsFailed + (failed ? 1 : 0),
      errorLog: error ? [...crawlRun.errorLog, error] : crawlRun.errorLog,
      status: crawlRunStatusAfterFetch(crawlRun, failed),
    });
  }
}

function crawlRunStatusAfterFetch(
  crawlRun: CrawlRunRecord,
  failed: boolean,
): CrawlRunRecord["status"] {
  if (crawlRun.status === "FAILED") {
    return "FAILED";
  }

  if (failed || crawlRun.documentsFailed > 0) {
    return "PARTIAL";
  }

  return crawlRun.status;
}
