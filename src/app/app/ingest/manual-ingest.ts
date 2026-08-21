import type { SupabaseClient } from "@supabase/supabase-js";

import { canonicalizeUrl } from "@/ingestion/url";

type JsonRecord = Record<string, unknown>;

export const urlCandidateSelectColumns =
  "id,source_id,crawl_run_id,discovery_type,original_url,canonical_url,title,published_at,last_modified_at,status,metadata,created_at,updated_at";

export const ingestionJobSelectColumns =
  "id,source_id,crawl_run_id,url_candidate_id,document_id,job_kind,status,attempts,max_attempts,scheduled_at,locked_at,finished_at,error_message,metadata,created_at,updated_at";

export type UrlCandidateRow = {
  id: string;
  source_id: string;
  crawl_run_id: string | null;
  discovery_type: "RSS" | "SITEMAP" | "NEWS_SITEMAP" | "MANUAL";
  original_url: string;
  canonical_url: string;
  title: string | null;
  published_at: string | null;
  last_modified_at: string | null;
  status: "PENDING" | "FETCHED" | "SKIPPED" | "FAILED";
  metadata: JsonRecord | null;
  created_at: string;
  updated_at: string;
};

export type IngestionJobRow = {
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
  locked_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  metadata: JsonRecord | null;
  created_at: string;
  updated_at: string;
};

export type ManualIngestionResult = {
  candidate: UrlCandidateRow;
  job: IngestionJobRow;
  canonicalUrl: string;
  reusedCandidate: boolean;
  reusedJob: boolean;
};

export function buildManualCandidatePayload(input: {
  sourceId: string;
  url: string;
  existingMetadata?: JsonRecord | null;
  submittedAt: Date;
}) {
  const canonicalUrl = canonicalizeUrl(input.url);

  return {
    source_id: input.sourceId,
    discovery_type: "MANUAL" as const,
    original_url: input.url.trim(),
    canonical_url: canonicalUrl,
    status: "PENDING" as const,
    metadata: {
      ...(input.existingMetadata ?? {}),
      manualSubmission: true,
      lastManualSubmissionAt: input.submittedAt.toISOString(),
    },
  };
}

export function buildFetchJobPayload(input: {
  candidate: UrlCandidateRow;
  canonicalUrl: string;
  submittedAt: Date;
}) {
  return {
    source_id: input.candidate.source_id,
    crawl_run_id: input.candidate.crawl_run_id,
    url_candidate_id: input.candidate.id,
    job_kind: "FETCH_URL" as const,
    status: "PENDING" as const,
    attempts: 0,
    max_attempts: 3,
    scheduled_at: input.submittedAt.toISOString(),
    metadata: {
      canonicalUrl: input.canonicalUrl,
      manualSubmission: true,
    },
  };
}

export async function createManualIngestionJob(
  supabase: SupabaseClient,
  input: { sourceId: string; url: string; submittedAt?: Date },
): Promise<ManualIngestionResult> {
  const submittedAt = input.submittedAt ?? new Date();
  const canonicalUrl = canonicalizeUrl(input.url);

  const existingCandidateResult = await supabase
    .from("url_candidates")
    .select(urlCandidateSelectColumns)
    .eq("source_id", input.sourceId)
    .eq("canonical_url", canonicalUrl)
    .maybeSingle();

  if (existingCandidateResult.error) {
    throw new Error(existingCandidateResult.error.message);
  }

  const candidatePayload = buildManualCandidatePayload({
    sourceId: input.sourceId,
    url: input.url,
    existingMetadata: existingCandidateResult.data
      ? ((existingCandidateResult.data as UrlCandidateRow).metadata ?? {})
      : {},
    submittedAt,
  });

  const candidateResult = existingCandidateResult.data
    ? await supabase
        .from("url_candidates")
        .update(candidatePayload)
        .eq("id", (existingCandidateResult.data as UrlCandidateRow).id)
        .select(urlCandidateSelectColumns)
        .single()
    : await supabase
        .from("url_candidates")
        .insert(candidatePayload)
        .select(urlCandidateSelectColumns)
        .single();

  if (candidateResult.error) {
    throw new Error(candidateResult.error.message);
  }

  const candidate = candidateResult.data as UrlCandidateRow;
  const existingJobResult = await supabase
    .from("ingestion_jobs")
    .select(ingestionJobSelectColumns)
    .eq("url_candidate_id", candidate.id)
    .eq("job_kind", "FETCH_URL")
    .in("status", ["PENDING", "RUNNING"])
    .maybeSingle();

  if (existingJobResult.error) {
    throw new Error(existingJobResult.error.message);
  }

  if (existingJobResult.data) {
    return {
      candidate,
      job: existingJobResult.data as IngestionJobRow,
      canonicalUrl,
      reusedCandidate: Boolean(existingCandidateResult.data),
      reusedJob: true,
    };
  }

  const jobResult = await supabase
    .from("ingestion_jobs")
    .insert(buildFetchJobPayload({ candidate, canonicalUrl, submittedAt }))
    .select(ingestionJobSelectColumns)
    .single();

  if (jobResult.error) {
    throw new Error(jobResult.error.message);
  }

  return {
    candidate,
    job: jobResult.data as IngestionJobRow,
    canonicalUrl,
    reusedCandidate: Boolean(existingCandidateResult.data),
    reusedJob: false,
  };
}
