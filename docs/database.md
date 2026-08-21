# Database Foundation

Phase 1 introduces the first Supabase/PostgreSQL schema in
`supabase/migrations/202608180001_phase_1_schema_foundation.sql`.
Phase 6 adds entity-resolution review persistence in
`supabase/migrations/202608180003_phase_6_entity_resolution.sql`.
Phase 7 adds deterministic evidence-scoring metadata in
`supabase/migrations/202608180004_phase_7_claim_validation.sql`.
Phase 11 adds URL discovery candidates in
`supabase/migrations/202608180005_phase_11_url_discovery.sql`.
Phase 12 adds scheduled crawl configuration and retryable ingestion jobs in
`supabase/migrations/202608180006_phase_12_scheduling.sql`.
Phase 13 grants Supabase API role privileges required for PostgREST access in
`supabase/migrations/202608210001_phase_13_api_role_privileges.sql`.

## Scope

The migration creates:

- controlled enum types for entities, predicates, connection classes, verification statuses, source types, access statuses, extraction statuses, source quality classes, and user roles
- core tables for sources, entities, aliases, documents, claims, claim evidence, review queue, audit log, LLM runs, and crawl runs
- entity-resolution tasks and candidate rows for ambiguous or low-confidence matches
- deterministic claim evidence score and compact validation notes
- URL candidates for RSS, sitemap, news sitemap, and manual discovery
- crawl schedules and retryable ingestion jobs for repeatable fetch, extraction, and analysis work
- indexes for graph, document, review, and audit queries
- a deferrable database trigger that prevents `VERIFIED` claims without at least one evidence record
- Row Level Security policies that keep internal data private and expose only verified, source-backed claim data through direct public reads
- API role grants that let PostgREST reach the RLS-protected tables before policies decide row and operation access

## App Roles

RLS reads the app role from the Supabase JWT:

```text
app_metadata.app_role
user_metadata.app_role
```

Supported values are:

```text
ADMIN
RESEARCHER
REVIEWER
PUBLIC
```

If no role is present, the request is treated as `PUBLIC`.

## Public Data Boundary

Direct public reads are intentionally narrow:

- `claims`: only `VERIFIED` claims with at least one evidence record
- `claim_evidence`: only evidence attached to verified claims
- `entities`: only entities connected to verified, evidence-backed claims

The public policies do not expose `documents`, `sources`, `review_queue`, `audit_log`, `llm_runs`, or `crawl_runs`. Later public API routes should project safe source and document metadata explicitly instead of exposing raw internal tables.
The public policies also do not expose `entity_resolution_tasks` or
`entity_resolution_candidates`; these contain unresolved research context and
are internal review data.
The public policies also do not expose `url_candidates`; discovered URLs are
internal queue data until they become reviewed, source-backed public claims.
The public policies also do not expose `crawl_schedules` or `ingestion_jobs`;
these are internal operational records for fetching, extraction, retries, and
LLM-analysis scheduling.

## Local Secrets

The repository still does not require production secrets for tests. Use `.env.local` for local Supabase credentials when application code starts connecting to Supabase.
