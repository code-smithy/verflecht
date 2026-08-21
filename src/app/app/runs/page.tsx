"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getBrowserSupabaseClient } from "@/app/auth-client";
import { buildSiteUrl } from "@/app/auth-paths";

import {
  ingestionJobSelectColumns,
  urlCandidateSelectColumns,
  type IngestionJobRow,
  type UrlCandidateRow,
} from "../ingest/manual-ingest";
import { sourceSelectColumns, type SourceRegistryRow } from "../sources/source-registry";

const crawlRunSelectColumns =
  "id,source_id,started_at,finished_at,status,urls_discovered,documents_fetched,documents_changed,documents_failed,error_log,created_at,updated_at";

type CrawlRunRow = {
  id: string;
  source_id: string;
  started_at: string;
  finished_at: string | null;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL";
  urls_discovered: number;
  documents_fetched: number;
  documents_changed: number;
  documents_failed: number;
  error_log: Array<Record<string, unknown>> | null;
  created_at: string;
  updated_at: string;
};

type ProcessState = "idle" | "processing" | "processed" | "error";

export default function CrawlRunsPage() {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [jobs, setJobs] = useState<IngestionJobRow[]>([]);
  const [candidates, setCandidates] = useState<UrlCandidateRow[]>([]);
  const [crawlRuns, setCrawlRuns] = useState<CrawlRunRow[]>([]);
  const [sources, setSources] = useState<SourceRegistryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processState, setProcessState] = useState<ProcessState>("idle");
  const [processMessage, setProcessMessage] = useState<string | null>(null);

  const sourcesById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );
  const candidatesById = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate])),
    [candidates],
  );

  const loadOperations = useCallback(
    async (options: { active?: () => boolean } = {}) => {
      if (!supabase) {
        setError("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to load runs.");
        setIsLoading(false);
        return;
      }

      const [jobsResult, candidatesResult, crawlRunsResult, sourcesResult] = await Promise.all([
        supabase
          .from("ingestion_jobs")
          .select(ingestionJobSelectColumns)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("url_candidates")
          .select(urlCandidateSelectColumns)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("crawl_runs")
          .select(crawlRunSelectColumns)
          .order("created_at", { ascending: false })
          .limit(25),
        supabase.from("sources").select(sourceSelectColumns),
      ]);

      if (options.active && !options.active()) {
        return;
      }

      setIsLoading(false);

      const firstError =
        jobsResult.error ?? candidatesResult.error ?? crawlRunsResult.error ?? sourcesResult.error;

      if (firstError) {
        setError(firstError.message);
        return;
      }

      setJobs((jobsResult.data ?? []) as IngestionJobRow[]);
      setCandidates((candidatesResult.data ?? []) as UrlCandidateRow[]);
      setCrawlRuns((crawlRunsResult.data ?? []) as CrawlRunRow[]);
      setSources((sourcesResult.data ?? []) as SourceRegistryRow[]);
    },
    [supabase],
  );

  useEffect(() => {
    let active = true;

    void loadOperations({ active: () => active });

    return () => {
      active = false;
    };
  }, [loadOperations]);

  async function processPendingFetchJob() {
    setProcessState("processing");
    setProcessMessage(null);

    if (!supabase) {
      setProcessState("error");
      setProcessMessage(
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to process jobs.",
      );
      return;
    }

    const { data, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !data.session) {
      setProcessState("error");
      setProcessMessage(sessionError?.message ?? "Sign in before processing jobs.");
      return;
    }

    try {
      const response = await fetch(
        buildSiteUrl(window.location.origin, "/api/ingestion/process-fetch-jobs/"),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${data.session.access_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ limit: 1 }),
        },
      );
      const payload = (await response.json()) as {
        processed?: number;
        error?: string;
        results?: Array<{ outcome: string; errorMessage?: string }>;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? `Processor returned ${response.status}.`);
      }

      const outcome = payload.results?.[0]?.outcome;
      const errorMessage = payload.results?.[0]?.errorMessage;
      setProcessState("processed");
      setProcessMessage(
        payload.processed === 0
          ? "No due pending fetch jobs found."
          : errorMessage
            ? `${outcome}: ${errorMessage}`
            : `Processed ${payload.processed} fetch job${payload.processed === 1 ? "" : "s"}.`,
      );
      await loadOperations();
    } catch (processError) {
      setProcessState("error");
      setProcessMessage(
        processError instanceof Error ? processError.message : "Could not process fetch jobs.",
      );
    }
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Pipeline operations</p>
        <h1>Crawl Runs</h1>
        <p>Monitor discovery, fetch, extraction, and retryable ingestion jobs.</p>
      </header>

      {error ? (
        <section className="form-status error" role="alert">
          {error}
        </section>
      ) : null}

      <section className="workspace-panel">
        <div className="panel-heading-row">
          <h2>Ingestion jobs</h2>
          <button
            disabled={processState === "processing"}
            onClick={processPendingFetchJob}
            type="button"
          >
            {processState === "processing" ? "Processing..." : "Process pending fetch job"}
          </button>
        </div>
        {processMessage ? (
          <div
            className={processState === "error" ? "form-status error" : "form-status success"}
            role={processState === "error" ? "alert" : "status"}
          >
            {processMessage}
          </div>
        ) : null}
        {isLoading ? <p className="muted-copy">Loading jobs...</p> : null}
        {!isLoading && jobs.length === 0 ? (
          <div className="empty-state compact">
            <strong>No ingestion jobs yet</strong>
            <span>Create one from the ingest screen.</span>
          </div>
        ) : null}
        {jobs.length > 0 ? (
          <div className="table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Source</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Scheduled</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const candidate = job.url_candidate_id
                    ? candidatesById.get(job.url_candidate_id)
                    : undefined;

                  return (
                    <tr key={job.id}>
                      <td>{formatJobKind(job.job_kind)}</td>
                      <td>{sourceName(sourcesById, job.source_id)}</td>
                      <td>
                        {candidate?.canonical_url ?? metadataText(job.metadata, "canonicalUrl")}
                      </td>
                      <td>
                        <span className={`status-pill ${job.status.toLocaleLowerCase()}`}>
                          {job.status}
                        </span>
                      </td>
                      <td>
                        {job.attempts}/{job.max_attempts}
                      </td>
                      <td>{formatTimestamp(job.scheduled_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="workspace-panel">
        <h2>URL candidates</h2>
        {candidates.length === 0 && !isLoading ? (
          <div className="empty-state compact">
            <strong>No URL candidates yet</strong>
            <span>Manual imports and discovery runs create candidates here.</span>
          </div>
        ) : null}
        {candidates.length > 0 ? (
          <div className="table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Source</th>
                  <th>Discovery</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.id}>
                    <td>{candidate.canonical_url}</td>
                    <td>{sourceName(sourcesById, candidate.source_id)}</td>
                    <td>{candidate.discovery_type}</td>
                    <td>
                      <span className={`status-pill ${candidate.status.toLocaleLowerCase()}`}>
                        {candidate.status}
                      </span>
                    </td>
                    <td>{formatTimestamp(candidate.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="workspace-panel">
        <h2>Crawl run history</h2>
        {crawlRuns.length === 0 && !isLoading ? (
          <div className="empty-state compact">
            <strong>No crawl runs yet</strong>
            <span>Scheduled feed and sitemap discovery runs will appear here.</span>
          </div>
        ) : null}
        {crawlRuns.length > 0 ? (
          <div className="table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Discovered</th>
                  <th>Fetched</th>
                  <th>Failed</th>
                </tr>
              </thead>
              <tbody>
                {crawlRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{formatTimestamp(run.started_at)}</td>
                    <td>{sourceName(sourcesById, run.source_id)}</td>
                    <td>
                      <span className={`status-pill ${run.status.toLocaleLowerCase()}`}>
                        {run.status}
                      </span>
                    </td>
                    <td>{run.urls_discovered}</td>
                    <td>{run.documents_fetched}</td>
                    <td>{run.documents_failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function sourceName(sourcesById: Map<string, SourceRegistryRow>, sourceId: string): string {
  return sourcesById.get(sourceId)?.name ?? sourceId;
}

function metadataText(metadata: Record<string, unknown> | null, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function formatJobKind(value: string): string {
  return value
    .toLocaleLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}
