"use client";

import { useMemo, useState, type FormEvent } from "react";

import { getBrowserSupabaseClient } from "@/app/auth-client";
import { sourceTypes, type SourceQualityClass, type SourceType } from "@/domain/ontology";

const sourceQualityOptions = [
  { value: "A", label: "A - official primary source" },
  { value: "B", label: "B - organisation or company source" },
  { value: "C", label: "C - multiple reputable journalistic sources" },
  { value: "D", label: "D - single reputable journalistic source" },
  { value: "E", label: "E - indirect or weak signal" },
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

type SaveState = "idle" | "saving" | "saved" | "error";

export default function InternalSourcesPage() {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("OFFICIAL_REGISTER");
  const [sourceQuality, setSourceQuality] = useState<SourceQualityClass>("A");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    const normalizedDomain = normalizeDomain(domain);

    if (!trimmedName) {
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

    const { error } = await supabase.from("sources").insert({
      name: trimmedName,
      domain: normalizedDomain || null,
      source_type: sourceType,
      source_quality: sourceQuality,
      enabled: true,
    });

    if (error) {
      setSaveState("error");
      setMessage(error.message);
      return;
    }

    setName("");
    setDomain("");
    setSourceType("OFFICIAL_REGISTER");
    setSourceQuality("A");
    setSaveState("saved");
    setMessage(`Saved ${trimmedName}.`);
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Source registry</p>
        <h1>Sources</h1>
        <p>Configure domains, source type, quality rating, crawl limits, and publication rules.</p>
      </header>
      <section className="workspace-panel">
        <h2>Add source</h2>
        <form className="admin-form" onSubmit={saveSource}>
          <label>
            <span>Name</span>
            <input
              onChange={(event) => setName(event.target.value)}
              placeholder="Parliament Register"
              required
              value={name}
            />
          </label>
          <label>
            <span>Domain</span>
            <input
              inputMode="url"
              onChange={(event) => setDomain(event.target.value)}
              placeholder="parliament.example"
              value={domain}
            />
          </label>
          <label>
            <span>Source type</span>
            <select
              onChange={(event) => setSourceType(event.target.value as SourceType)}
              value={sourceType}
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
              onChange={(event) => setSourceQuality(event.target.value as SourceQualityClass)}
              value={sourceQuality}
            >
              {sourceQualityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {message ? (
            <div
              className={saveState === "saved" ? "form-status success" : "form-status error"}
              role={saveState === "saved" ? "status" : "alert"}
            >
              {message}
            </div>
          ) : null}
          <button disabled={saveState === "saving"} type="submit">
            {saveState === "saving" ? "Saving..." : "Save source"}
          </button>
        </form>
      </section>
    </main>
  );
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}
