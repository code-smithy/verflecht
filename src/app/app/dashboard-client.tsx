"use client";

import { useEffect, useMemo, useState } from "react";

import { getUserAppRole } from "../auth-roles";
import { getBrowserSupabaseClient } from "../auth-client";
import {
  createDashboardSupabaseClient,
  loadDashboardSnapshot,
  type DashboardSnapshot,
} from "./dashboard-data";

const loadingMetrics = [
  { label: "Sources", value: "...", note: "Configured registries and feeds" },
  { label: "Documents", value: "...", note: "Fetched or imported records" },
  { label: "Pending Claims", value: "...", note: "Candidates awaiting reviewer action" },
  { label: "Public Claims", value: "...", note: "Verified and source-backed" },
  { label: "Review Workload", value: "...", note: "Active queue plus unqueued candidates" },
  { label: "Retryable Jobs", value: "...", note: "Failed ingestion work scheduled again" },
];

export function DashboardClient() {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSnapshot() {
      if (!supabase) {
        setError("Supabase browser configuration is missing.");
        return;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      if (sessionError || !data.session) {
        setError(sessionError?.message ?? "No active Supabase session.");
        return;
      }

      try {
        const nextSnapshot = await loadDashboardSnapshot(
          createDashboardSupabaseClient(supabase),
          getUserAppRole(data.session.user),
        );

        if (active) {
          setSnapshot(nextSnapshot);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "Dashboard data failed to load.",
          );
        }
      }
    }

    void loadSnapshot();

    return () => {
      active = false;
    };
  }, [supabase]);

  const metrics = snapshot?.metrics ?? loadingMetrics;

  return (
    <>
      {error ? (
        <section className="auth-alert" role="alert">
          {error}
        </section>
      ) : null}
      <section className="metric-grid" aria-label="Pipeline metrics">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span>{metric.value}</span>
            <strong>{metric.label}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </section>
      <section className="workspace-panel">
        <h2>Reviewer workload</h2>
        <div className="status-grid" aria-label="Review workload">
          <span>{formatStatusValue(snapshot?.reviewWorkload.openQueueItems)} open</span>
          <span>{formatStatusValue(snapshot?.reviewWorkload.assignedQueueItems)} assigned</span>
          <span>
            {formatStatusValue(snapshot?.reviewWorkload.unqueuedCandidates)} unqueued candidates
          </span>
          <span>{formatStatusValue(snapshot?.reviewWorkload.totalActiveItems)} active total</span>
        </div>
      </section>
      <section className="workspace-panel">
        <h2>Ingestion retries</h2>
        <div className="status-grid" aria-label="Retryable ingestion work">
          <span>{formatStatusValue(snapshot?.ingestionWork.retryableFailures)} retryable</span>
          <span>{formatStatusValue(snapshot?.ingestionWork.dueRetryableFailures)} due now</span>
          <span>{formatStatusValue(snapshot?.ingestionWork.runningJobs)} running</span>
          <span>{formatStatusValue(snapshot?.ingestionWork.exhaustedFailures)} exhausted</span>
        </div>
      </section>
      <section className="workspace-panel">
        <h2>Operational wiring</h2>
        <ul className="check-list">
          <li>Supabase Auth session is required before the internal workspace renders.</li>
          <li>Internal workspace access is limited to ADMIN, RESEARCHER, and REVIEWER roles.</li>
          <li>Dashboard counts are loaded through authenticated Supabase table reads.</li>
          <li>
            Retryable ingestion failures and review workload are surfaced from pipeline state.
          </li>
        </ul>
      </section>
    </>
  );
}

function formatStatusValue(value: number | undefined): string {
  return value === undefined ? "..." : new Intl.NumberFormat("en-US").format(value);
}
