# URL Ingestion

Phase 3 introduces manual URL ingestion under `src/ingestion`.
Phase 11 adds feed and sitemap discovery under `src/ingestion/discovery.ts`.

## Boundaries

- `url.ts` canonicalizes ingestible HTTP(S) URLs by removing fragments, tracking parameters, default ports, and common AMP/print variants while preserving language variants by default.
- `fetcher.ts` performs HTTP fetches with manual redirect handling, timeout, retry policy, user agent, robots.txt checks, content-type detection, access-status mapping, and per-host rate limiting.
- `hash.ts` computes SHA-256 hashes for fetched raw content.
- `storage.ts` defines the raw-document storage boundary. `SupabaseRawDocumentStorage` writes to Supabase Storage and `InMemoryRawDocumentStorage` is used for deterministic unit tests.
- `url-ingestion.ts` coordinates fetch, hash, raw-content storage, and immutable document-record creation through the existing domain service.
- `discovery.ts` parses RSS, Atom, sitemap, and news sitemap documents, then stores discovered URLs as deduplicated URL candidates before document fetching.

## Deduplication and Versioning

The importer treats each row in `documents` as one immutable document version. It deduplicates by:

```text
canonical_url + content_hash
```

If the same canonical URL is imported again with the same SHA-256 hash, the existing document is returned and no new storage object or document record is created.

If the canonical URL is the same but the hash changes, a new document record is created. The version number is stored in `document.metadata.documentVersion` until a later migration introduces an explicit version column or table.

## Access Status

The fetcher maps HTTP status codes and explicit paywall markers to the controlled `access_status` ontology:

- `PUBLIC` for successful public responses.
- `PAYWALLED` for payment-required responses, paywall headers, or visible paywall markers.
- `LOGIN_REQUIRED` for 401.
- `BLOCKED` for 403 and 451.
- `REMOVED` for 404 and 410.
- `UNKNOWN` for other unclassified failures.

Paywall handling records metadata and any freely returned body content. It does not implement bypass behavior.

## Test Coverage

Phase 3 tests cover:

- canonicalization of tracking parameters, fragments, AMP/print variants, redirects, and language variants
- retry and timeout behavior with mocked HTTP
- robots.txt blocking
- rate limiting
- paywall status mapping
- SHA-256 hashing and raw storage paths
- idempotent repeated import
- changed-content document versioning

Phase 11 tests cover:

- RSS parsing
- sitemap and news sitemap parsing
- URL candidate canonicalization and deduplication
- crawl run statistics
- failed sitemap child isolation
