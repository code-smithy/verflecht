"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { getBrowserSupabaseClient } from "@/app/auth-client";
import { sourceTypes, type SourceQualityClass, type SourceType } from "@/domain/ontology";

import {
  buildSourceSavePayload,
  defaultSourceForm,
  mergeSavedSource,
  sourceFormFromRow,
  sourceSelectColumns,
  type SourceFormState,
  type SourceRegistryRow,
} from "./source-registry";

const sourceQualityOptions = [
  { value: "A", label: "A - official primary source" },
  { value: "B", label: "B - organisation or company source" },
  { value: "C", label: "C - multiple reputable journalistic sources" },
  { value: "D", label: "D - single reputable journalistic source" },
  { value: "E", label: "E - indirect or weak signal" },
  { value: "X", label: "X - contradicted or disproven" },
] satisfies Array<{ value: SourceQualityClass; label: string }>;

const sourceTypeLabels = {
  OFFICIAL_REGISTER: "Official register",
  PARLIAMENT: "Parliament",
  GOVERNMENT: "Government",
  COMPANY_REGISTER: "Company register",
  COMPANY_WEBSITE: "Company website",
  ORGANISATION_WEBSITE: "Organisation website",
  NEWS_ARTICLE: "News article",
  PRESS_RELEASE: "Press release",
  EVENT_PROGRAM: "Event program",
  PDF: "PDF",
  SOCIAL_MEDIA: "Social media",
  MANUAL_RESEARCH: "Manual research",
  OTHER: "Other",
} satisfies Record<SourceType, string>;

type SaveState = "idle" | "loading" | "saving" | "saved" | "error";

export default function InternalSourcesPage() {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [sources, setSources] = useState<SourceRegistryRow[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [form, setForm] = useState<SourceFormState>(defaultSourceForm);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [message, setMessage] = useState<string | null>(null);

  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? null;

  useEffect(() => {
    let active = true;

    async function loadSources() {
      if (!supabase) {
        setSaveState("error");
        setMessage(
          "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to load sources.",
        );
        return;
      }

      const { data, error } = await supabase
        .from("sources")
        .select(sourceSelectColumns)
        .order("updated_at", { ascending: false });

      if (!active) {
        return;
      }

      if (error) {
        setSaveState("error");
        setMessage(error.message);
        return;
      }

      const loadedSources = (data ?? []) as SourceRegistryRow[];
      setSources(loadedSources);
      setSaveState("idle");

      if (loadedSources.length > 0) {
        setSelectedSourceId(loadedSources[0].id);
        setForm(sourceFormFromRow(loadedSources[0]));
      }
    }

    void loadSources();

    return () => {
      active = false;
    };
  }, [supabase]);

  function updateForm<K extends keyof SourceFormState>(key: K, value: SourceFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startNewSource() {
    setSelectedSourceId(null);
    setForm(defaultSourceForm);
    setMessage(null);
    setSaveState("idle");
  }

  function selectSource(source: SourceRegistryRow) {
    setSelectedSourceId(source.id);
    setForm(sourceFormFromRow(source));
    setMessage(null);
    setSaveState("idle");
  }

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = buildSourceSavePayload(form);

    if (!payload.name) {
      setSaveState("error");
      setMessage("Enter a source name before saving.");
      return;
    }

    if (!supabase) {
      setSaveState("error");
      setMessage("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to save sources.");
      return;
    }

    setSaveState("saving");
    setMessage(null);

    const query = selectedSource
      ? supabase.from("sources").update(payload).eq("id", selectedSource.id)
      : supabase.from("sources").insert(payload);

    const { data, error } = await query.select(sourceSelectColumns).single();

    if (error) {
      setSaveState("error");
      setMessage(error.message);
      return;
    }

    const savedSource = data as SourceRegistryRow;
    setSources((current) => mergeSavedSource(current, savedSource));
    setSelectedSourceId(savedSource.id);
    setForm(sourceFormFromRow(savedSource));
    setSaveState("saved");
    setMessage(`${selectedSource ? "Updated" : "Saved"} ${savedSource.name}.`);
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Source registry</p>
        <h1>Sources</h1>
        <p>Configure domains, source type, quality rating, crawl limits, and publication rules.</p>
      </header>

      <section className="source-workspace">
        <aside className="workspace-panel source-list-panel">
          <div className="panel-heading-row">
            <h2>Saved sources</h2>
            <button onClick={startNewSource} type="button">
              New source
            </button>
          </div>
          {saveState === "loading" ? <p className="muted-copy">Loading sources...</p> : null}
          {saveState !== "loading" && sources.length === 0 ? (
            <div className="empty-state compact">
              <strong>No sources yet</strong>
              <span>Save a source to make it available for ingestion.</span>
            </div>
          ) : null}
          {sources.length > 0 ? (
            <div className="source-list" role="list">
              {sources.map((source) => (
                <button
                  aria-current={source.id === selectedSourceId ? "true" : undefined}
                  className={source.id === selectedSourceId ? "active" : undefined}
                  key={source.id}
                  onClick={() => selectSource(source)}
                  type="button"
                >
                  <strong>{source.name}</strong>
                  <span>{source.domain || "No domain"}</span>
                  <small>
                    {sourceTypeLabels[source.source_type]} &middot; Quality {source.source_quality}{" "}
                    &middot; {source.enabled ? "Enabled" : "Paused"}
                  </small>
                </button>
              ))}
            </div>
          ) : null}
        </aside>

        <section className="workspace-panel">
          <div className="panel-heading-row">
            <h2>{selectedSource ? "Edit source" : "Add source"}</h2>
            {selectedSource ? <span className="record-id">ID {selectedSource.id}</span> : null}
          </div>
          <form className="admin-form source-form" onSubmit={saveSource}>
            <label>
              <span>Name</span>
              <input
                onChange={(event) => updateForm("name", event.target.value)}
                placeholder="Parliament Register"
                required
                value={form.name}
              />
            </label>
            <label>
              <span>Domain</span>
              <input
                inputMode="url"
                onChange={(event) => updateForm("domain", event.target.value)}
                placeholder="parliament.example"
                value={form.domain}
              />
            </label>
            <label>
              <span>Source type</span>
              <select
                onChange={(event) => updateForm("sourceType", event.target.value as SourceType)}
                value={form.sourceType}
              >
                {sourceTypes.map((type) => (
                  <option key={type} value={type}>
                    {sourceTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Source quality</span>
              <select
                onChange={(event) =>
                  updateForm("sourceQuality", event.target.value as SourceQualityClass)
                }
                value={form.sourceQuality}
              >
                {sourceQualityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Requests per minute</span>
              <input
                min={0}
                onChange={(event) =>
                  updateForm("requestsPerMinute", numberInputValue(event.target.valueAsNumber, 0))
                }
                type="number"
                value={form.requestsPerMinute}
              />
            </label>
            <label>
              <span>Concurrency</span>
              <input
                max={10}
                min={1}
                onChange={(event) =>
                  updateForm("concurrency", numberInputValue(event.target.valueAsNumber, 1))
                }
                type="number"
                value={form.concurrency}
              />
            </label>
            <div className="checkbox-grid">
              <label>
                <input
                  checked={form.enabled}
                  onChange={(event) => updateForm("enabled", event.target.checked)}
                  type="checkbox"
                />
                <span>Enabled</span>
              </label>
              <label>
                <input
                  checked={form.respectRobots}
                  onChange={(event) => updateForm("respectRobots", event.target.checked)}
                  type="checkbox"
                />
                <span>Respect robots.txt</span>
              </label>
              <label>
                <input
                  checked={form.javascriptRequired}
                  onChange={(event) => updateForm("javascriptRequired", event.target.checked)}
                  type="checkbox"
                />
                <span>JavaScript required</span>
              </label>
              <label>
                <input
                  checked={form.storeRawHtml}
                  onChange={(event) => updateForm("storeRawHtml", event.target.checked)}
                  type="checkbox"
                />
                <span>Store raw HTML</span>
              </label>
              <label>
                <input
                  checked={form.allowLlmProcessing}
                  onChange={(event) => updateForm("allowLlmProcessing", event.target.checked)}
                  type="checkbox"
                />
                <span>Allow LLM processing</span>
              </label>
              <label>
                <input
                  checked={form.publishFullText}
                  onChange={(event) => updateForm("publishFullText", event.target.checked)}
                  type="checkbox"
                />
                <span>Publish full text</span>
              </label>
            </div>
            {message ? (
              <div
                className={saveState === "saved" ? "form-status success" : "form-status error"}
                role={saveState === "saved" ? "status" : "alert"}
              >
                {message}
              </div>
            ) : null}
            <button disabled={saveState === "saving"} type="submit">
              {saveState === "saving"
                ? "Saving..."
                : selectedSource
                  ? "Save changes"
                  : "Save source"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

function numberInputValue(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
