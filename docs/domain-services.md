# Domain Services

Phase 2 introduces a tested domain-service layer under `src/domain`.

## Boundaries

- `records.ts` defines camelCase application records that mirror the Phase 1 database tables.
- `repository.ts` defines the repository contract and an in-memory implementation for unit tests.
- `services.ts` owns business rules for entities, sources, documents, claims, evidence, reviewer transitions, supersession, and audit logging.
- `public-graph.ts` projects safe public graph data from repository records.

Supabase remains the source of truth. The in-memory repository is only a local implementation of the repository contract for deterministic unit tests and should be replaced by a Supabase-backed implementation when application routes begin reading and writing live data.

## Reviewer Rules

Claims cannot be inserted as `VERIFIED`. They must move through `ResearchDomainService.verifyClaim`, which checks:

- subject and object entities exist
- subject and object entity types are compatible with the predicate ontology
- the claim has at least one evidence record
- literal-only claims are not emitted as public graph relationships yet

Reviewer actions create audit log entries for verification, rejection, dispute, outdated transitions, and supersession.

## Public Graph Rules

`PublicGraphService.getPublicGraph` returns only verified claims that have source-backed evidence. It excludes:

- `DETECTED`
- `PENDING_REVIEW`
- `REJECTED`
- `DISPUTED`
- `OUTDATED`
- claims without evidence
- claims whose evidence cannot be traced to a document and source
- raw document text, storage paths, source metadata, audit fields, reviewer fields, and creator fields

Supported filters are entity id, entity type, predicate, connection class, and historical inclusion.
