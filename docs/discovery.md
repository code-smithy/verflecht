# URL Discovery

Phase 11 adds RSS, Atom, sitemap, and news sitemap discovery under
`src/ingestion/discovery.ts`.

## Boundaries

- Discovery fetches feed and sitemap documents through the existing `UrlFetcher`, so redirects,
  robots.txt, timeout, retry, user-agent, and rate-limit behavior stay centralized.
- Discovery stores found article/page URLs as `url_candidates` before document fetching or
  extraction starts.
- URL candidates are deduplicated by `source_id + canonical_url`.
- Sitemap indexes are followed recursively with a bounded depth.
- Failed sitemap children or unsupported discovery documents are recorded in the crawl run error log
  without stopping other discovery items.

## Candidate Records

Each candidate stores:

- source and optional crawl run
- discovery type: `RSS`, `SITEMAP`, `NEWS_SITEMAP`, or `MANUAL`
- original and canonical URL
- optional title, publication date, and sitemap last-modified date
- candidate status
- metadata such as the discovery feed/sitemap URL

Candidates remain private internal data. Public graph APIs still expose only verified claims with
source-backed evidence.

## Crawl Run Stats

Phase 11 discovery updates crawl runs with:

- discovered candidate count
- failed discovery item count
- status: `SUCCEEDED`, `PARTIAL`, or `FAILED`
- structured error log entries

`documents_fetched` and `documents_changed` remain zero during discovery. Later ingestion phases can
advance URL candidates into fetched document versions.
