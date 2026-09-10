# Political Network Research Platform — Requirements

## Current architecture

The source of truth is local `data/research.json`. A standard-library Python pipeline validates records and produces a browser-ready public JSON graph. Next.js reads that export. No hosted database, database credentials, authentication service, or remote storage is required.

The initial dataset is empty. Adding sources is a later task. The source registry uses only `official`, `organisation`, `media`, and `other`; formats and discovery mechanisms are separate concerns for future adapters.

The exact implemented contract is documented in [data-format.md](data-format.md).

## Research principles

1. Every published relationship must have a concrete source and matching evidence excerpt.
2. Only manually reviewed `VERIFIED` claims may appear publicly. Machine extraction may create candidates only.
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
- Start with a meaningful empty state; show loading and data errors separately.

## Later work (not part of this backend replacement)

- Source-specific fetching, extraction, URL canonicalization, immutable document import, deduplication, and crawl reports.
- Optional LLM extraction into unverified candidates, semantic evidence checks, and entity resolution.
- Review tools, stronger enforced history/auditing, and multi-user editing if needed.
- Interactive network visualization, search, graph filters, entity details, and timelines.
- Scheduled refreshes once actual sources and refresh needs are known.

Future fetchers must respect access controls, paywalls, rate limits, and source-specific publication rules. The current pipeline performs no fetching. Do not introduce infrastructure for these later features before it is needed.

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
