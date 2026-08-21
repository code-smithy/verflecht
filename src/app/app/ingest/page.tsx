"use client";

import { useEffect, useMemo, useState } from "react";

import { getBrowserSupabaseClient } from "@/app/auth-client";

import { sourceSelectColumns, type SourceRegistryRow } from "../sources/source-registry";

export default function IngestPage() {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [sources, setSources] = useState<SourceRegistryRow[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);

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
            <input placeholder="https://example.ch/article" type="url" />
          </label>
          <button disabled={!selectedSourceId} type="button">
            Create ingestion job
          </button>
        </form>
      </section>
      <section className="workspace-panel">
        <h2>Expected output</h2>
        <div className="status-grid">
          <span>Canonical URL</span>
          <span>Fetch status</span>
          <span>Content hash</span>
          <span>Extraction status</span>
        </div>
      </section>
    </main>
  );
}
