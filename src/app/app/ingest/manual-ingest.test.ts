import { describe, expect, it } from "vitest";

import {
  buildFetchJobPayload,
  buildManualCandidatePayload,
  type UrlCandidateRow,
} from "./manual-ingest";

describe("manual ingestion helpers", () => {
  it("builds a manual URL candidate with a canonical URL", () => {
    const submittedAt = new Date("2026-08-21T09:00:00.000Z");

    expect(
      buildManualCandidatePayload({
        sourceId: "source-1",
        url: " HTTPS://Example.COM/story?utm_source=newsletter&b=2#a ",
        existingMetadata: { previous: true },
        submittedAt,
      }),
    ).toEqual({
      source_id: "source-1",
      discovery_type: "MANUAL",
      original_url: "HTTPS://Example.COM/story?utm_source=newsletter&b=2#a",
      canonical_url: "https://example.com/story?b=2",
      status: "PENDING",
      metadata: {
        previous: true,
        manualSubmission: true,
        lastManualSubmissionAt: "2026-08-21T09:00:00.000Z",
      },
    });
  });

  it("builds a pending fetch job for the candidate", () => {
    const submittedAt = new Date("2026-08-21T09:00:00.000Z");
    const candidate = {
      id: "candidate-1",
      source_id: "source-1",
      crawl_run_id: null,
      discovery_type: "MANUAL",
      original_url: "https://example.com/story",
      canonical_url: "https://example.com/story",
      title: null,
      published_at: null,
      last_modified_at: null,
      status: "PENDING",
      metadata: {},
      created_at: "2026-08-21T09:00:00.000Z",
      updated_at: "2026-08-21T09:00:00.000Z",
    } satisfies UrlCandidateRow;

    expect(
      buildFetchJobPayload({
        candidate,
        canonicalUrl: "https://example.com/story",
        submittedAt,
      }),
    ).toEqual({
      source_id: "source-1",
      crawl_run_id: null,
      url_candidate_id: "candidate-1",
      job_kind: "FETCH_URL",
      status: "PENDING",
      attempts: 0,
      max_attempts: 3,
      scheduled_at: "2026-08-21T09:00:00.000Z",
      metadata: {
        canonicalUrl: "https://example.com/story",
        manualSubmission: true,
      },
    });
  });
});
