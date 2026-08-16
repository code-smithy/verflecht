# Political Network Research Platform - Implementation Plan

## Purpose

This document converts `docs/requirements.md` into an executable, testable implementation plan.

The platform is a source-backed political network research system. Its core promise is not graph visualization alone, but traceable, reviewable claims where every public relationship can be traced back to concrete evidence and a source.

## Current Repository State

The repository is currently greenfield:

- `README.md`
- `docs/requirements.md`
- no application stack
- no Supabase migrations
- no tests
- no CI configuration

Because no stack exists yet, implementation should choose a small, conventional architecture and avoid adding unnecessary infrastructure.

## Non-Negotiable Engineering Rules

1. Supabase/PostgreSQL is the source of truth.
2. No second relational primary database may be introduced.
3. LLM output can only create candidates, never public facts.
4. Public graph APIs may expose only verified claims.
5. A claim cannot be verified without evidence.
6. Evidence must point to a concrete source document.
7. Historical, official, direct, and indirect relationships must remain distinguishable.
8. Paywalls must not be bypassed.
9. Secrets must never be committed, logged, stored in client code, or written to database content.
10. Every generated code path must be covered by unit tests in the same implementation phase.

## Proposed Baseline Stack

Use this as the default unless a future repository discovery step finds an existing architecture:

- TypeScript for application and pipeline code.
- Next.js or another React-based framework for the web UI and server routes.
- Supabase for PostgreSQL, auth, storage, row-level security, and edge/runtime integrations where appropriate.
- Vitest for unit tests.
- Playwright only for later browser-level smoke tests, not as the primary unit-test tool.
- Zod or equivalent schema validation for LLM and API contracts.

The first implementation task should confirm these choices before scaffolding.

## Domain Model Summary

The MVP data model must support:

- Sources and source quality.
- Documents and immutable document versions.
- Raw document storage references.
- Entities and aliases.
- Claims as internal relationship records.
- Claim evidence.
- Review queue.
- Audit log.
- LLM run metadata.
- Crawl runs and retryable pipeline state.

The controlled ontologies from `docs/requirements.md` must be represented in code and database constraints:

- entity types
- relation predicates
- connection classes
- verification statuses
- source types
- access statuses
- extraction statuses
- source quality classes
- user roles

## Test Strategy

Every implementation phase that generates code must add unit tests before the phase is considered complete.

Minimum unit-test expectations:

- Database-facing service functions test validation, filtering, and status transitions.
- URL canonicalization tests cover tracking parameters, fragments, canonical redirects where mocked, AMP/print handling, and language variants where implemented.
- Hashing and document deduplication tests cover unchanged and changed content.
- Ontology validation tests reject unknown predicates, invalid entity types, and incompatible relationships.
- Evidence validation tests prove evidence text exists in the document and captures correct context.
- LLM schema tests reject malformed output and unknown relation types.
- Review workflow tests prove unverified, rejected, disputed, and pending claims cannot appear in public graph output.
- Claim correction tests prove verified claims are superseded rather than silently overwritten.
- RLS or policy tests must cover public/private visibility boundaries where technically testable.

No production code should be merged without adjacent tests or a documented reason why the code is not executable logic.

## Acceptance Criteria Coverage Plan

The acceptance criteria in `docs/requirements.md` should become tracked tests:

| AC | Test Coverage |
| --- | --- |
| AC-01 | Document import deduplicates unchanged URL/content hash. |
| AC-02 | LLM relation schema rejects predicates outside the ontology. |
| AC-03 | Review service refuses to verify claims without evidence. |
| AC-04 | Evidence validator confirms evidence text is present in source text. |
| AC-05 | Public graph excludes `PENDING_REVIEW`. |
| AC-06 | Public graph excludes `REJECTED`. |
| AC-07 | Claim projection distinguishes historical and current relationships. |
| AC-08 | Event entity creation and event relationship tests. |
| AC-09 | Multiple claims can reference one source. |
| AC-10 | One claim can have multiple evidence/source records. |
| AC-11 | Claim edits create superseding claims and preserve history. |
| AC-12 | Public edge projection requires at least one source-backed evidence record. |
| AC-13 | Ambiguous entity resolution routes to manual review. |
| AC-14 | Paywall handling stores metadata without bypass behavior. |
| AC-15 | Failed crawl item does not stop the remaining crawl run. |
| AC-16 | Crawl and analysis jobs are idempotent and retryable. |
| AC-17 | Editorial actions write audit log entries. |
| AC-18 | Public read paths exclude internal review and audit data. |

## Step-by-Step Implementation Plan

### Phase 0 - Project Scaffold and Quality Gates

Goal: establish the smallest viable development foundation.

Tasks:

- Select and scaffold the application stack.
- Add TypeScript configuration.
- Add unit-test runner and test scripts.
- Add linting and formatting scripts.
- Add environment variable template without secrets.
- Add CI workflow for unit tests and linting.
- Add a test coverage threshold once meaningful code exists.

Unit tests required:

- Initial smoke test proving the test runner works.
- Configuration tests only if executable configuration helpers are introduced.

Exit criteria:

- `npm test` or equivalent runs locally.
- CI can run tests without requiring production secrets.

### Phase 1 - Supabase Schema Foundation

Goal: create the core relational model and integrity constraints.

Tasks:

- Add migrations for entities, aliases, sources, documents, claims, claim evidence, review queue, audit log, LLM runs, crawl runs, and controlled enums.
- Add indexes for graph and review queries.
- Add database constraints preventing impossible states where feasible.
- Add seed data for ontology values and sample non-sensitive records.

Unit tests required:

- Schema helper tests for enum/predicate compatibility.
- Migration validation tests where the chosen tooling supports isolated test databases.
- Service-level tests for claim verification preconditions.

Exit criteria:

- A claim without evidence cannot be verified through application services.
- Unknown predicates cannot be inserted through application services.
- Verified claim changes preserve history through supersession.

### Phase 2 - Data Access and Domain Services

Goal: isolate business rules behind tested services.

Tasks:

- Implement repository/service layer for entities, sources, documents, claims, evidence, and audit log.
- Implement controlled ontology module.
- Implement claim state transitions.
- Implement public graph projection query/service.
- Implement audit logging for editorial changes.

Unit tests required:

- Claim state transition tests.
- Public graph filtering tests.
- Audit-log creation tests.
- Ontology compatibility tests.

Exit criteria:

- Public projection returns only verified, source-backed claims.
- Pending, rejected, disputed, and internal fields are excluded from public outputs.

### Phase 3 - URL Ingestion MVP

Goal: support manual URL ingestion into immutable document records.

Tasks:

- Implement URL canonicalization.
- Implement fetcher with redirect handling, timeout, retry policy, user agent, content-type detection, robots.txt respect, and rate limiting.
- Implement SHA-256 content hashing.
- Store raw content in Supabase Storage and store only references in PostgreSQL.
- Implement document versioning and deduplication.
- Implement paywall metadata behavior without bypassing access controls.

Unit tests required:

- URL canonicalization cases.
- Fetch retry and timeout behavior with mocked HTTP.
- Hashing and deduplication.
- Paywall status mapping.
- Idempotent repeated import.

Exit criteria:

- Importing the same unchanged URL twice does not create duplicate document versions.
- Changed content creates a new document version.

### Phase 4 - HTML Extraction

Goal: extract normalized document metadata and text.

Tasks:

- Extract title, author, published date, publisher, description, body text, and language.
- Prefer JSON-LD, Schema.org, OpenGraph, HTML metadata, then visible-content extraction.
- Mark partial, metadata-only, and failed extractions explicitly.

Unit tests required:

- JSON-LD extraction.
- OpenGraph fallback extraction.
- Visible-content fallback extraction.
- Partial and failed extraction status cases.

Exit criteria:

- Extracted document text and metadata are deterministic for fixture HTML files.

### Phase 5 - LLM Provider Abstraction and Entity Extraction

Goal: introduce LLM calls without coupling business logic to a model.

Tasks:

- Implement provider abstraction for `extractEntities`, `resolveEntityCandidates`, `extractClaims`, and `validateClaim`.
- Add prompt and schema version tracking.
- Validate all LLM outputs against JSON schemas.
- Persist LLM run metadata without logging unnecessary full copyrighted text.

Unit tests required:

- Provider abstraction tests with mocked providers.
- Entity extraction schema validation tests.
- Invalid output rejection tests.
- LLM run logging tests.

Exit criteria:

- Invalid LLM output cannot create entities, resolutions, claims, or evidence.

### Phase 6 - Entity Resolution

Goal: resolve extracted mentions to entities while preserving ambiguity.

Tasks:

- Implement candidate matching using canonical name, aliases, party, canton, position, organization, country, time period, and co-mentioned entities.
- Add configurable thresholds.
- Route ambiguous or low-confidence matches to manual review.
- Prevent automatic merges for ambiguous people.

Unit tests required:

- Exact alias match.
- Ambiguous surname match.
- Same-name different-canton case.
- Below-threshold manual review case.
- No automatic merge for ambiguous people.

Exit criteria:

- Entity resolution produces candidates and review tasks rather than unsafe automatic identity merges.

### Phase 7 - Claim Extraction and Evidence Validation

Goal: produce reviewable relationship candidates only when supported by evidence.

Tasks:

- Implement claim extraction using resolved entities and allowed predicates.
- Validate evidence text exists in the document.
- Validate subject/object context.
- Validate relation type and entity-type compatibility.
- Detect likely negation and mark for review or rejection.
- Calculate deterministic evidence score separately from LLM confidence.

Unit tests required:

- Positive relationship fixture.
- Negated relationship fixture.
- Historical relationship fixture.
- Official meeting fixture.
- Event participation fixture.
- Co-mention without relationship fixture.
- Third-party quote fixture.
- Contradicted claim fixture.
- Ambiguous person fixture.
- Multiple people with same organization fixture.

Exit criteria:

- Claim candidates that fail validation cannot become verified automatically.
- Sensitive topics always require human verification.

### Phase 8 - Review Workflow

Goal: provide human verification before publication.

Tasks:

- Build internal review UI for claim candidates.
- Show subject, predicate, object, source, URL, publisher, dates, evidence, context, entity resolution, LLM confidence, evidence score, and source quality.
- Implement actions: verify, edit, reject, mark disputed, merge entity, create entity.
- Ensure verified claim edits create superseding claims.
- Write audit log entries for all editorial actions.

Unit tests required:

- Verify action.
- Edit action with supersession.
- Reject action.
- Mark disputed action.
- Audit-log creation for every action.
- Public graph visibility after each action.

Exit criteria:

- Only reviewer-approved claims can become public.

### Phase 9 - Public API and Graph Projection

Goal: expose verified data safely.

Tasks:

- Implement `/api/graph`.
- Implement `/api/entities/:id`.
- Implement `/api/claims/:id`.
- Add filters for entity type, predicate, connection class, topic, person, organization, date range, and historical inclusion.
- Ensure every edge includes source and evidence metadata.

Unit tests required:

- Public graph filter tests.
- Entity detail projection tests.
- Claim detail projection tests.
- Source-backed edge requirement tests.
- Private/internal field exclusion tests.

Exit criteria:

- Public APIs cannot expose pending review data, rejected claims, audit internals, crawler credentials, or internal prompts.

### Phase 10 - Public UI

Goal: build the public research interface.

Tasks:

- Build interactive network view with zoom, pan, drag, selection, search, filters, neighbor highlighting, clusters, and detail panel.
- Build person search.
- Build person detail view.
- Build timeline view.
- Build source/evidence display.
- Build table-based research view with sorting and filtering.

Unit tests required:

- UI component tests for graph filters.
- Detail panel rendering tests.
- Timeline classification tests.
- Search result rendering tests.
- Source/evidence display tests.

Exit criteria:

- No edge is displayed without source and evidence details.
- Historical relationships are visually distinct from current relationships.

### Phase 11 - RSS and Sitemap Discovery

Goal: expand ingestion beyond manual URLs.

Tasks:

- Implement RSS discovery.
- Implement sitemap discovery.
- Implement news sitemap discovery where available.
- Store all discovered URLs as candidates before fetching.
- Add crawl run statistics.

Unit tests required:

- RSS parsing fixtures.
- Sitemap parsing fixtures.
- Candidate deduplication.
- Crawl run stats.
- Failed item isolation.

Exit criteria:

- Failed discovery or fetch items do not block the rest of a crawl run.

### Phase 12 - Scheduling and Change Detection

Goal: make ingestion repeatable and auditable.

Tasks:

- Add configurable scheduled crawl frequencies.
- Implement retryable job states.
- Compare new and old content hashes.
- Skip LLM analysis for unchanged content.
- Trigger extraction for changed document versions.

Unit tests required:

- Scheduled job configuration tests.
- Retry state transition tests.
- Unchanged hash skip tests.
- Changed hash re-analysis tests.
- Idempotent job execution tests.

Exit criteria:

- Crawl and analysis jobs can be rerun safely without producing duplicate facts.

## First Implementation Slice

The first code-producing slice should be deliberately small:

1. Scaffold the TypeScript app and test runner.
2. Add the ontology module.
3. Add unit tests proving allowed and rejected predicates, entity types, connection classes, verification statuses, and source types.
4. Add initial Supabase migration for ontology-dependent core tables.
5. Add service tests for the rule: a claim without evidence cannot be verified.

This slice establishes the discipline needed for the rest of the project: domain rules first, public data later.

## Documentation Rules Going Forward

Every future implementation phase must update documentation when it introduces or changes:

- database schema
- public API shape
- LLM prompt contract
- ontology values
- review workflow behavior
- security/RLS behavior
- environment variables
- test strategy

Documentation updates should be committed with the code they describe.

