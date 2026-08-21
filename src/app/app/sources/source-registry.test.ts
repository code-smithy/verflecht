import { describe, expect, it } from "vitest";

import {
  buildSourceSavePayload,
  mergeSavedSource,
  normalizeDomain,
  sourceFormFromRow,
  type SourceRegistryRow,
} from "./source-registry";

const baseSource = {
  id: "source-1",
  name: "Parliament Register",
  domain: "parliament.example",
  source_type: "PARLIAMENT",
  source_quality: "A",
  enabled: true,
  respect_robots: true,
  requests_per_minute: 10,
  concurrency: 1,
  javascript_required: false,
  store_raw_html: true,
  allow_llm_processing: true,
  publish_full_text: false,
  created_at: "2026-08-21T08:00:00.000Z",
  updated_at: "2026-08-21T08:00:00.000Z",
} satisfies SourceRegistryRow;

describe("source registry helpers", () => {
  it("normalizes source domains from bare domains and URLs", () => {
    expect(normalizeDomain(" Parliament.Example ")).toBe("parliament.example");
    expect(normalizeDomain("https://news.example/articles?id=1")).toBe("news.example");
    expect(normalizeDomain("not a url")).toBe("not a url");
  });

  it("maps edited form state into the Supabase source payload", () => {
    const payload = buildSourceSavePayload({
      ...sourceFormFromRow(baseSource),
      name: " Updated Source ",
      domain: "https://source.example/path",
      requestsPerMinute: 12.8,
      concurrency: 99,
    });

    expect(payload).toEqual({
      name: "Updated Source",
      domain: "source.example",
      source_type: "PARLIAMENT",
      source_quality: "A",
      enabled: true,
      respect_robots: true,
      requests_per_minute: 12,
      concurrency: 10,
      javascript_required: false,
      store_raw_html: true,
      allow_llm_processing: true,
      publish_full_text: false,
    });
  });

  it("replaces a saved source in the visible registry", () => {
    const oldSource = {
      ...baseSource,
      id: "source-2",
      name: "Old source",
      updated_at: "2026-08-21T07:00:00.000Z",
    } satisfies SourceRegistryRow;
    const updatedSource = {
      ...baseSource,
      name: "Updated Parliament Register",
      updated_at: "2026-08-21T09:00:00.000Z",
    } satisfies SourceRegistryRow;

    expect(
      mergeSavedSource([baseSource, oldSource], updatedSource).map((source) => source.name),
    ).toEqual(["Updated Parliament Register", "Old source"]);
  });
});
