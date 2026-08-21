import type { SourceQualityClass, SourceType } from "@/domain/ontology";

export const sourceSelectColumns =
  "id,name,domain,source_type,source_quality,enabled,respect_robots,requests_per_minute,concurrency,javascript_required,store_raw_html,allow_llm_processing,publish_full_text,created_at,updated_at";

export const defaultSourceForm = {
  name: "",
  domain: "",
  sourceType: "OFFICIAL_REGISTER",
  sourceQuality: "A",
  enabled: true,
  respectRobots: true,
  requestsPerMinute: 10,
  concurrency: 1,
  javascriptRequired: false,
  storeRawHtml: true,
  allowLlmProcessing: true,
  publishFullText: false,
} satisfies SourceFormState;

export type SourceRegistryRow = {
  id: string;
  name: string;
  domain: string | null;
  source_type: SourceType;
  source_quality: SourceQualityClass;
  enabled: boolean;
  respect_robots: boolean;
  requests_per_minute: number;
  concurrency: number;
  javascript_required: boolean;
  store_raw_html: boolean;
  allow_llm_processing: boolean;
  publish_full_text: boolean;
  created_at: string;
  updated_at: string;
};

export type SourceFormState = {
  name: string;
  domain: string;
  sourceType: SourceType;
  sourceQuality: SourceQualityClass;
  enabled: boolean;
  respectRobots: boolean;
  requestsPerMinute: number;
  concurrency: number;
  javascriptRequired: boolean;
  storeRawHtml: boolean;
  allowLlmProcessing: boolean;
  publishFullText: boolean;
};

export type SourceSavePayload = {
  name: string;
  domain: string | null;
  source_type: SourceType;
  source_quality: SourceQualityClass;
  enabled: boolean;
  respect_robots: boolean;
  requests_per_minute: number;
  concurrency: number;
  javascript_required: boolean;
  store_raw_html: boolean;
  allow_llm_processing: boolean;
  publish_full_text: boolean;
};

export function normalizeDomain(value: string): string {
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

export function buildSourceSavePayload(form: SourceFormState): SourceSavePayload {
  return {
    name: form.name.trim(),
    domain: normalizeDomain(form.domain) || null,
    source_type: form.sourceType,
    source_quality: form.sourceQuality,
    enabled: form.enabled,
    respect_robots: form.respectRobots,
    requests_per_minute: clampInteger(form.requestsPerMinute, 0, 600),
    concurrency: clampInteger(form.concurrency, 1, 10),
    javascript_required: form.javascriptRequired,
    store_raw_html: form.storeRawHtml,
    allow_llm_processing: form.allowLlmProcessing,
    publish_full_text: form.publishFullText,
  };
}

export function sourceFormFromRow(row: SourceRegistryRow): SourceFormState {
  return {
    name: row.name,
    domain: row.domain ?? "",
    sourceType: row.source_type,
    sourceQuality: row.source_quality,
    enabled: row.enabled,
    respectRobots: row.respect_robots,
    requestsPerMinute: row.requests_per_minute,
    concurrency: row.concurrency,
    javascriptRequired: row.javascript_required,
    storeRawHtml: row.store_raw_html,
    allowLlmProcessing: row.allow_llm_processing,
    publishFullText: row.publish_full_text,
  };
}

export function mergeSavedSource(
  sources: readonly SourceRegistryRow[],
  savedSource: SourceRegistryRow,
): SourceRegistryRow[] {
  const withoutSavedSource = sources.filter((source) => source.id !== savedSource.id);

  return [savedSource, ...withoutSavedSource].sort((left, right) =>
    right.updated_at.localeCompare(left.updated_at),
  );
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}
