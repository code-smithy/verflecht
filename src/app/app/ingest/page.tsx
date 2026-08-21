"use client";

import { useEffect, useMemo, useState } from "react";

import { getBrowserSupabaseClient } from "@/app/auth-client";

import { createManualIngestionJob, type ManualIngestionResult } from "./manual-ingest";
import { sourceSelectColumns, type SourceRegistryRow } from "../sources/source-registry";

type SubmitState = "idle" | "submitting" | "submitted" | "error";

export default function IngestPage() {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [sources, setSources] = useState<SourceRegistryRow[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [url, setUrl] = useState("");
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ManualIngestionResult | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSources() {
      if (!supabase) {
        setSourceError(
          "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to load sources.",
        );
        setIsLoadingSources(false);
        return;
      }

      const { data, error } = await supabase
        .from("sources")
        .select(sourceSelectColumns)
        .eq("enabled", true)
        .order("name", { ascending: true });

      if (!active) {
        return;
      }

      setIsLoadingSources(false);

      if (error) {
        setSourceError(error.message);
        return;
      }

      const loadedSources = (data ?? []) as SourceRegistryRow[];
      setSources(loadedSources);
      setSelectedSourceId(loadedSources[0]?.id ?? "");
    }

    void loadSources();

    return () => {
      active = false;
    };
  }, [supabase]);

  async function submitManualIngestion() {
    setSubmitMessage(null);
    setResult(null);

    if (!supabase) {
      setSubmitState("error");
      setSubmitMessage(
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to create ingestion jobs.",
      );
      return;
    }

    if (!selectedSourceId) {
      setSubmitState("error");
      setSubmitMessage("Select a source before creating an ingestion job.");
      return;
    }

    if (!url.trim()) {
      setSubmitState("error");
      setSubmitMessage("Enter a URL before creating an ingestion job.");
      return;
    }

    setSubmitState("submitting");

    try {
      const nextResult = await createManualIngestionJob(supabase, {
        sourceId: selectedSourceId,
        url,
      });

      setResult(nextResult);
      setSubmitState("submitted");
      setSubmitMessage(
        nextResult.reusedJob
          ? "An active fetch job already exists for this URL."
          : "Created a pending fetch job for this URL.",
      );
    } catch (error) {
      setSubmitState("error");
      setSubmitMessage(error instanceof Error ? error.message : "Could not create ingestion job.");
    }
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Manual ingestion</p>
        <h1>Ingest</h1>
        <p>Add URLs, fetch source documents, extract text, and create reviewable pipeline jobs.</p>
      </header>
      <section className="workspace-panel">
        <h2>Manual URL import</h2>
        <form className="admin-form">
          <label>
            <span>Source</span>
            <select
              disabled={isLoadingSources || sources.length === 0}
              onChange={(event) => setSelectedSourceId(event.target.value)}
              value={selectedSourceId}
            >
              {isLoadingSources ? <option>Loading sources...</option> : null}
              {!isLoadingSources && sources.length === 0 ? (
                <option>No enabled sources found</option>
              ) : null}
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                  {source.domain ? ` (${source.domain})` : ""}
                </option>
              ))}
            </select>
          </label>
          {sourceError ? (
            <div className="form-status error" role="alert">
              {sourceError}
            </div>
          ) : null}
          <label>
            <span>URL</span>
            <input
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.ch/article"
              type="url"
              value={url}
            />
          </label>
          {submitMessage ? (
            <div
              className={submitState === "submitted" ? "form-status success" : "form-status error"}
              role={submitState === "submitted" ? "status" : "alert"}
            >
              {submitMessage}
            </div>
          ) : null}
          <button
            disabled={!selectedSourceId || submitState === "submitting"}
            onClick={submitManualIngestion}
            type="button"
          >
            {submitState === "submitting" ? "Creating..." : "Create ingestion job"}
          </button>
        </form>
      </section>
      <section className="workspace-panel">
        <h2>Expected output</h2>
        <div className="status-grid">
          <span>{result?.canonicalUrl ?? "Canonical URL"}</span>
          <span>{result?.job.status ?? "Fetch status"}</span>
          <span>{result?.candidate.id ?? "URL candidate"}</span>
          <span>{result?.job.id ?? "Ingestion job"}</span>
        </div>
      </section>
    </main>
  );
}
