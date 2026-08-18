# Domain Services

Phase 2 introduces a tested domain-service layer under `src/domain`.

## Boundaries

- `records.ts` defines camelCase application records that mirror the Phase 1 database tables.
- `repository.ts` defines the repository contract and an in-memory implementation for unit tests.
- `services.ts` owns business rules for entities, sources, documents, claims, evidence, reviewer transitions, supersession, crawl schedules, ingestion job retries, and audit logging.
- `review-workflow.ts` projects reviewer-facing claim context and coordinates review actions against the domain service.
- `public-graph.ts` projects safe public graph data from repository records.

Supabase remains the source of truth. The in-memory repository is only a local implementation of the repository contract for deterministic unit tests and should be replaced by a Supabase-backed implementation when application routes begin reading and writing live data.

## Reviewer Rules

Claims cannot be inserted as `VERIFIED`. They must move through `ResearchDomainService.verifyClaim`, which checks:

- subject and object entities exist
- subject and object entity types are compatible with the predicate ontology
- the claim has at least one evidence record
- literal-only claims are not emitted as public graph relationships yet

Reviewer actions create audit log entries for verification, rejection, dispute, outdated transitions, and supersession.

## Review Workflow Rules

`ReviewWorkflowService` is the internal review boundary for Phase 8. It builds queue items with:

- subject, predicate, object, and connection class
- source, URL, publisher, publication date, retrieval date, evidence, and surrounding context
- entity-resolution tasks and candidates tied to evidence documents
- LLM confidence, deterministic evidence score, and source quality

The service exposes review actions for verify, reject, mark disputed, edit verified claim, create entity, and merge entity. Editing a verified claim creates a replacement claim with `supersedesClaimId`, adds replacement evidence, marks the original `OUTDATED`, verifies the reviewer-approved replacement, and resolves active queue rows. Create and merge entity actions write audit log records, and entity merges preserve the source entity with merge metadata instead of deleting it.

## Public Graph Rules

`PublicGraphService.getPublicGraph` returns only verified claims that have source-backed evidence. It supports public filters for entity id, entity type, predicate, connection class, topic, person, organization, validity date range, and historical inclusion.

The same service also projects public entity and claim detail responses for Phase 9 API routes. Entity detail includes safe aliases, verified claims, connected entities, events, sources, and a timeline. Claim detail includes subject, relation, object, classification, validity, `VERIFIED` status, evidence, and source metadata.

It excludes:

- `DETECTED`
- `PENDING_REVIEW`
- `REJECTED`
- `DISPUTED`
- `OUTDATED`
- claims without evidence
- claims whose evidence cannot be traced to a document and source
- raw document text, storage paths, source metadata, audit fields, reviewer fields, creator fields, review queue fields, and LLM prompt internals

Public route behavior is documented in [Public API](public-api.md).

## Scheduling Rules

Phase 12 adds crawl schedules and ingestion jobs to the same domain boundary. Schedules require an
existing source and at least one discovery URL. Jobs validate source, crawl-run, candidate, and
document references before persistence. Failed jobs return to `PENDING` with bounded exponential
backoff until `maxAttempts` is exhausted.
