import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AccessStatus,
  ExtractionStatus,
  SourceQualityClass,
  SourceType,
} from "@/domain/ontology";
import { UrlFetcher } from "@/ingestion/fetcher";
import { sha256Hex } from "@/ingestion/hash";
import { buildRawDocumentPath, SupabaseRawDocumentStorage } from "@/ingestion/storage";
import { canonicalizeUrl } from "@/ingestion/url";

type JsonRecord = Record<string, unknown>;

type SourceRow = {
  id: string;
  name: string;
  domain: string | null;
  source_type: SourceType;
  source_quality: SourceQualityClass;
  enabled: boolean;
  respect_robots: boolean;
  requests_per_minute: number;
  metadata: JsonRecord | null;
};

type UrlCandidateRow = {
  id: string;
  source_id: string;
  crawl_run_id: string | null;
  original_url: string;
  canonical_url: string;
  status: "PENDING" | "FETCHED" | "SKIPPED" | "FAILED";
  metadata: JsonRecord | null;
};

type IngestionJobRow = {
  id: string;
  source_id: string;
  crawl_run_id: string | null;
  url_candidate_id: string | null;
  document_id: string | null;
  job_kind: "DISCOVER_URLS" | "FETCH_URL" | "EXTRACT_DOCUMENT" | "ANALYZE_DOCUMENT";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  attempts: number;
  max_attempts: number;
  scheduled_at: string;
  metadata: JsonRecord | null;
};

type DocumentRow = {
  id: string;
  source_id: string;
  canonical_url: string | null;
  content_hash: string | null;
  metadata: JsonRecord | null;
};

export type ProcessFetchJobOutcome =
  "CREATED" | "CREATED_NEW_VERSION" | "UNCHANGED" | "FAILED_RETRYABLE" | "FAILED_EXHAUSTED";

export type ProcessFetchJobResult = {
  jobId: string;
  candidateId?: string;
  documentId?: string;
  canonicalUrl?: string;
  contentHash?: string;
  outcome: ProcessFetchJobOutcome;
  errorMessage?: string;
};

type FetchJobProcessorOptions = {
  limit?: number;
  now?: Date;
  storageBucket?: string;
};

const sourceSelectColumns =
  "id,name,domain,source_type,source_quality,enabled,respect_robots,requests_per_minute,metadata";
const candidateSelectColumns =
  "id,source_id,crawl_run_id,original_url,canonical_url,status,metadata";
const jobSelectColumns =
  "id,source_id,crawl_run_id,url_candidate_id,document_id,job_kind,status,attempts,max_attempts,scheduled_at,metadata";
const documentSelectColumns = "id,source_id,canonical_url,content_hash,metadata";

export async function processDueFetchJobs(
  supabase: SupabaseClient,
  options: FetchJobProcessorOptions = {},
): Promise<ProcessFetchJobResult[]> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 5;
  const { data, error } = await supabase
    .from("ingestion_jobs")
    .select(jobSelectColumns)
    .eq("job_kind", "FETCH_URL")
    .eq("status", "PENDING")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load pending fetch jobs: ${error.message}`);
  }

  const jobs = ((data ?? []) as IngestionJobRow[]).filter((job) => job.attempts < job.max_attempts);
  const results: ProcessFetchJobResult[] = [];

  for (const job of jobs) {
    results.push(
      await processFetchJob(supabase, job, {
        now: new Date(),
        storageBucket: options.storageBucket,
      }),
    );
  }

  return results;
}

async function processFetchJob(
  supabase: SupabaseClient,
  pendingJob: IngestionJobRow,
  options: Required<Pick<FetchJobProcessorOptions, "now">> &
    Pick<FetchJobProcessorOptions, "storageBucket">,
): Promise<ProcessFetchJobResult> {
  const runningJob = await startFetchJob(supabase, pendingJob, options.now);

  try {
    if (!runningJob.url_candidate_id) {
      throw new Error("FETCH_URL job is missing a URL candidate.");
    }

    const candidate = await loadCandidate(supabase, runningJob.url_candidate_id);
    const source = await loadSource(supabase, runningJob.source_id);
    const fetcher = new UrlFetcher({
      respectRobots: source.respect_robots,
      requestsPerMinute: source.requests_per_minute,
    });
    const fetchResult = await fetcher.fetch(candidate.original_url);
    const canonicalUrl = canonicalizeUrl(fetchResult.finalUrl);
    const contentHash = sha256Hex(fetchResult.body);
    const existingDocument = await findDocumentByCanonicalHash(supabase, canonicalUrl, contentHash);

    if (existingDocument) {
      await completeFetchJob(supabase, runningJob, {
        status: "SKIPPED",
        now: new Date(),
        metadata: {
          outcome: "UNCHANGED",
          documentId: existingDocument.id,
          contentHash,
          canonicalUrl,
          llmAnalysisSkipped: true,
        },
      });
      await updateCandidateAfterFetch(supabase, candidate, {
        status: "SKIPPED",
        metadata: {
          lastFetchJobId: runningJob.id,
          lastDocumentId: existingDocument.id,
          lastContentHash: contentHash,
          unchanged: true,
        },
      });

      return {
        jobId: runningJob.id,
        candidateId: candidate.id,
        documentId: existingDocument.id,
        canonicalUrl,
        contentHash,
        outcome: "UNCHANGED",
      };
    }

    const version = (await countDocumentVersions(supabase, canonicalUrl)) + 1;
    const rawStoragePath = buildRawDocumentPath({
      sourceType: source.source_type,
      sourceId: source.id,
      canonicalUrl,
      contentHash,
      contentType: fetchResult.contentType,
    });
    const storage = new SupabaseRawDocumentStorage(supabase, options.storageBucket);
    const stored = await storage.putRawDocument({
      path: rawStoragePath,
      body: fetchResult.body,
      contentType: fetchResult.contentType,
      metadata: {
        canonicalUrl,
        originalUrl: fetchResult.originalUrl,
        contentHash,
      },
    });
    const document = await createDocument(supabase, {
      sourceId: source.id,
      originalUrl: fetchResult.originalUrl,
      canonicalUrl,
      contentType: fetchResult.contentType,
      rawStoragePath: stored.path,
      contentHash,
      httpStatus: fetchResult.httpStatus,
      accessStatus: fetchResult.accessStatus,
      extractionStatus: fetchResult.extractionStatus,
      metadata: {
        documentVersion: version,
        redirectChain: fetchResult.redirectChain,
        finalUrl: fetchResult.finalUrl,
        responseHeaders: fetchResult.headers,
      },
    });
    const outcome: ProcessFetchJobOutcome = version > 1 ? "CREATED_NEW_VERSION" : "CREATED";

    await createDocumentJob(supabase, document.id, source.id, "EXTRACT_DOCUMENT", {
      trigger: outcome,
      sourceFetchJobId: runningJob.id,
    });
    const extractionJobMarker = { waitsForJobKind: "EXTRACT_DOCUMENT" };
    await createDocumentJob(supabase, document.id, source.id, "ANALYZE_DOCUMENT", {
      trigger: outcome,
      sourceFetchJobId: runningJob.id,
      ...extractionJobMarker,
    });
    await completeFetchJob(supabase, runningJob, {
      status: "SUCCEEDED",
      now: new Date(),
      metadata: {
        outcome,
        documentId: document.id,
        contentHash,
        canonicalUrl,
        llmAnalysisSkipped: false,
      },
    });
    await updateCandidateAfterFetch(supabase, candidate, {
      status: "FETCHED",
      metadata: {
        lastFetchJobId: runningJob.id,
        lastDocumentId: document.id,
        lastContentHash: contentHash,
        unchanged: false,
      },
    });

    return {
      jobId: runningJob.id,
      candidateId: candidate.id,
      documentId: document.id,
      canonicalUrl,
      contentHash,
      outcome,
    };
  } catch (error) {
    return failFetchJob(
      supabase,
      runningJob,
      error instanceof Error ? error.message : "Unknown ingestion error.",
      new Date(),
    );
  }
}

export function nextRetryAt(now: Date, attempts: number): Date {
  return new Date(now.getTime() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60 * 1000);
}

async function startFetchJob(
  supabase: SupabaseClient,
  job: IngestionJobRow,
  now: Date,
): Promise<IngestionJobRow> {
  const nextAttempts = job.attempts + 1;
  const { data, error } = await supabase
    .from("ingestion_jobs")
    .update({
      status: "RUNNING",
      attempts: nextAttempts,
      locked_at: now.toISOString(),
      error_message: null,
      updated_at: now.toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "PENDING")
    .select(jobSelectColumns)
    .single();

  if (error) {
    throw new Error(`Failed to start fetch job ${job.id}: ${error.message}`);
  }

  return data as IngestionJobRow;
}

async function failFetchJob(
  supabase: SupabaseClient,
  job: IngestionJobRow,
  errorMessage: string,
  now: Date,
): Promise<ProcessFetchJobResult> {
  const retryable = job.attempts < job.max_attempts;
  const status = retryable ? "PENDING" : "FAILED";
  const scheduledAt = retryable ? nextRetryAt(now, job.attempts).toISOString() : job.scheduled_at;

  const { error } = await supabase
    .from("ingestion_jobs")
    .update({
      status,
      scheduled_at: scheduledAt,
      locked_at: null,
      finished_at: retryable ? null : now.toISOString(),
      error_message: errorMessage,
      updated_at: now.toISOString(),
    })
    .eq("id", job.id);

  if (error) {
    throw new Error(`Failed to mark fetch job ${job.id} failed: ${error.message}`);
  }

  if (!retryable && job.url_candidate_id) {
    const candidate = await loadCandidate(supabase, job.url_candidate_id);
    await updateCandidateAfterFetch(supabase, candidate, {
      status: "FAILED",
      metadata: {
        lastFetchJobId: job.id,
        lastError: errorMessage,
      },
    });
  }

  return {
    jobId: job.id,
    candidateId: job.url_candidate_id ?? undefined,
    outcome: retryable ? "FAILED_RETRYABLE" : "FAILED_EXHAUSTED",
    errorMessage,
  };
}

async function completeFetchJob(
  supabase: SupabaseClient,
  job: IngestionJobRow,
  input: {
    status: "SUCCEEDED" | "SKIPPED";
    now: Date;
    metadata: JsonRecord;
  },
): Promise<void> {
  const { error } = await supabase
    .from("ingestion_jobs")
    .update({
      status: input.status,
      finished_at: input.now.toISOString(),
      locked_at: null,
      metadata: { ...(job.metadata ?? {}), ...input.metadata },
      updated_at: input.now.toISOString(),
    })
    .eq("id", job.id);

  if (error) {
    throw new Error(`Failed to complete fetch job ${job.id}: ${error.message}`);
  }
}

async function loadCandidate(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<UrlCandidateRow> {
  const { data, error } = await supabase
    .from("url_candidates")
    .select(candidateSelectColumns)
    .eq("id", candidateId)
    .single();

  if (error) {
    throw new Error(`Failed to load URL candidate ${candidateId}: ${error.message}`);
  }

  return data as UrlCandidateRow;
}

async function loadSource(supabase: SupabaseClient, sourceId: string): Promise<SourceRow> {
  const { data, error } = await supabase
    .from("sources")
    .select(sourceSelectColumns)
    .eq("id", sourceId)
    .single();

  if (error) {
    throw new Error(`Failed to load source ${sourceId}: ${error.message}`);
  }

  return data as SourceRow;
}

async function findDocumentByCanonicalHash(
  supabase: SupabaseClient,
  canonicalUrl: string,
  contentHash: string,
): Promise<DocumentRow | undefined> {
  const { data, error } = await supabase
    .from("documents")
    .select(documentSelectColumns)
    .eq("canonical_url", canonicalUrl)
    .eq("content_hash", contentHash)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check document deduplication: ${error.message}`);
  }

  return data ? (data as DocumentRow) : undefined;
}

async function countDocumentVersions(
  supabase: SupabaseClient,
  canonicalUrl: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("canonical_url", canonicalUrl);

  if (error) {
    throw new Error(`Failed to count document versions: ${error.message}`);
  }

  return count ?? 0;
}

async function createDocument(
  supabase: SupabaseClient,
  input: {
    sourceId: string;
    originalUrl: string;
    canonicalUrl: string;
    contentType?: string;
    rawStoragePath: string;
    contentHash: string;
    httpStatus: number;
    accessStatus: AccessStatus;
    extractionStatus: ExtractionStatus;
    metadata: JsonRecord;
  },
): Promise<DocumentRow> {
  const { data, error } = await supabase
    .from("documents")
    .insert({
      source_id: input.sourceId,
      original_url: input.originalUrl,
      canonical_url: input.canonicalUrl,
      content_type: input.contentType ?? null,
      raw_storage_path: input.rawStoragePath,
      content_hash: input.contentHash,
      http_status: input.httpStatus,
      access_status: input.accessStatus,
      extraction_status: input.extractionStatus,
      metadata: input.metadata,
    })
    .select(documentSelectColumns)
    .single();

  if (error) {
    throw new Error(`Failed to create document: ${error.message}`);
  }

  return data as DocumentRow;
}

async function createDocumentJob(
  supabase: SupabaseClient,
  documentId: string,
  sourceId: string,
  jobKind: "EXTRACT_DOCUMENT" | "ANALYZE_DOCUMENT",
  metadata: JsonRecord,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from("ingestion_jobs").insert({
    source_id: sourceId,
    document_id: documentId,
    job_kind: jobKind,
    status: "PENDING",
    attempts: 0,
    max_attempts: 3,
    scheduled_at: now,
    metadata,
  });

  if (error) {
    throw new Error(`Failed to create ${jobKind} job: ${error.message}`);
  }
}

async function updateCandidateAfterFetch(
  supabase: SupabaseClient,
  candidate: UrlCandidateRow,
  input: { status: UrlCandidateRow["status"]; metadata: JsonRecord },
): Promise<void> {
  const { error } = await supabase
    .from("url_candidates")
    .update({
      status: input.status,
      metadata: { ...(candidate.metadata ?? {}), ...input.metadata },
      updated_at: new Date().toISOString(),
    })
    .eq("id", candidate.id);

  if (error) {
    throw new Error(`Failed to update URL candidate ${candidate.id}: ${error.message}`);
  }
}
