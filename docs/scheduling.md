# Scheduling and Change Detection

Phase 12 adds repeatable ingestion orchestration under
`src/ingestion/scheduling.ts`.

## Boundaries

- Crawl schedules configure a source, frequency, discovery URLs, and next run time.
- Due schedules call the existing RSS/sitemap discovery service and advance `nextRunAt`.
- URL candidates are converted into retryable `FETCH_URL` ingestion jobs.
- Fetch jobs use the existing URL importer, so canonicalization, fetching, hashing, raw storage,
  document versioning, and paywall handling stay centralized.
- Unchanged content is marked `SKIPPED` and does not enqueue extraction or LLM analysis.
- New or changed document versions enqueue `EXTRACT_DOCUMENT` and `ANALYZE_DOCUMENT` jobs.

## Retry Rules

Ingestion jobs move through:

```text
PENDING -> RUNNING -> SUCCEEDED
PENDING -> RUNNING -> SKIPPED
PENDING -> RUNNING -> PENDING
PENDING -> RUNNING -> FAILED
```

Failures are retryable until `maxAttempts` is exhausted. Retry delays use bounded exponential
backoff, starting at one minute and capped at one hour.

## Idempotency

Active fetch jobs are deduplicated by URL candidate and job kind. Immutable document processing jobs
are deduplicated by document and job kind, so repeated scheduler execution cannot enqueue duplicate
extraction or analysis work for the same document version.

Hash comparison still happens in `url-ingestion.ts` through `canonicalUrl + contentHash`:

- same canonical URL and same hash returns the existing document and skips analysis
- same canonical URL and a new hash creates a new document version and queues downstream work

## Database

The matching Supabase schema is in
`supabase/migrations/202608180006_phase_12_scheduling.sql`.
