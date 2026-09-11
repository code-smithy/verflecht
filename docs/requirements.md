# Political Network Research Platform — Requirements

The Parliament normaliser also publishes explicit affair authorship and individual co-signatures from cached official records. It excludes inferred authors, vote similarity, and unverified topic mappings. See [the import documentation](parliament-import.md).

## Current architecture

The source of truth is local `data/research.json`. Python import scripts collect external source data into local, resumable archives and unverified research candidates. A separate standard-library Python pipeline validates reviewed records and produces a browser-ready public JSON graph. Next.js reads that export.

The application must remain login-free and must not depend on Supabase, a hosted database, database credentials, an authentication service, or remote application storage. GitHub Actions may retain pipeline checkpoints and artifacts, but it is not an application backend.

The Swiss Parliament public web service is the first source, with a resumable multilingual importer that runs once per night in GitHub Actions. Explicit council and committee memberships and active-member party/faction affiliations from this official source are published automatically with machine-verification provenance. Other imported or inferred relationships still require review. The source registry uses only `official`, `organisation`, `media`, and `other`; formats and discovery mechanisms are separate adapter concerns.

The exact implemented contract is documented in [data-format.md](data-format.md).

## Research principles

1. Every published relationship must have a concrete source and matching evidence excerpt.
2. Manually reviewed `VERIFIED` claims may appear publicly. Explicit factual relationships returned by an approved official structured API may also be marked `VERIFIED` automatically with machine provenance. Machine extraction and inferred relationships may create candidates only.
3. Common mention does not establish a relationship; event participation does not establish membership; official meetings do not establish personal or political affinity.
4. Preserve `DIRECT`, `INDIRECT`, `OFFICIAL`, and `HISTORICAL` distinctions and validity periods.
5. Treat events as entities; keep relation predicates controlled.
6. Preserve prior document versions and corrected claims with stable IDs and supersession. Review changes through version control.
7. Export only selected public fields. Never expose internal notes, full document text, or reviewer metadata through the viewer.
8. Separate facts, claims, and inference. Do not automatically merge ambiguous entities.

## Required local workflow

- Author sources, documents, entities, and claims in one JSON file.
- Validate required fields, IDs, references, controlled values, dates, evidence, and verified-claim review metadata.
- Reject malformed data with an actionable error and non-zero exit status.
- Keep the previous successful export untouched on validation failure.
- Produce deterministic output without network access.
- Export only reviewed relationships, evidence/source metadata, and connected entities.
- Support repeatable rebuilds and a read-only stale-export check in CI.
- Run collection pipelines once per night. A bounded run must save its checkpoint and stop; it must not dispatch an immediate continuation merely because the archive remains incomplete.
- Resume incomplete archives during the next nightly run without discarding already collected data.
- Start with a meaningful empty state; show loading and data errors separately.

## Later work (not part of this backend replacement)

- Source-specific fetching, extraction, URL canonicalization, immutable document import, deduplication, and crawl reports.
- Optional LLM extraction into unverified candidates, semantic evidence checks, and entity resolution.
- Review tools, stronger enforced history/auditing, and multi-user editing if needed.
- Interactive network visualization, search, graph filters, entity details, and timelines.

Fetchers must respect access controls, paywalls, rate limits, and source-specific publication rules. The build is offline; explicit source imports perform fetching separately. Do not introduce infrastructure for later features before it is needed.

## Acceptance checks for this version

- An empty dataset builds and displays without credentials.
- Invalid source types, relations, dates, duplicate IDs, and broken references fail validation.
- Missing or nonmatching evidence and absent review metadata prevent verification export.
- All non-verified statuses and internal fields remain outside the public graph.
- Supersession preserves authored history and hides replaced claims only after a verified replacement exists.
- Historical dates survive projection and display.
- Unchanged input yields identical output; failed builds preserve the last export.
- Python export fixtures satisfy the TypeScript consumer contract.
- CI runs Python and frontend tests, linting, type checking, formatting, stale-data checks, and a production build.
