# Database Foundation

Phase 1 introduces the first Supabase/PostgreSQL schema in
`supabase/migrations/202608180001_phase_1_schema_foundation.sql`.
Phase 6 adds entity-resolution review persistence in
`supabase/migrations/202608180003_phase_6_entity_resolution.sql`.

## Scope

The migration creates:

- controlled enum types for entities, predicates, connection classes, verification statuses, source types, access statuses, extraction statuses, source quality classes, and user roles
- core tables for sources, entities, aliases, documents, claims, claim evidence, review queue, audit log, LLM runs, and crawl runs
- entity-resolution tasks and candidate rows for ambiguous or low-confidence matches
- indexes for graph, document, review, and audit queries
- a deferrable database trigger that prevents `VERIFIED` claims without at least one evidence record
- Row Level Security policies that keep internal data private and expose only verified, source-backed claim data through direct public reads

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

## Local Secrets

The repository still does not require production secrets for tests. Use `.env.local` for local Supabase credentials when application code starts connecting to Supabase.
