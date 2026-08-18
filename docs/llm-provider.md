# LLM Provider Abstraction

Phase 5 introduces a provider-neutral LLM boundary under `src/llm`.

## Scope

- `contracts.ts` defines Zod schemas for entity extraction, entity resolution candidates, claim extraction, and claim validation.
- `provider.ts` defines the `LlmProvider` interface and `LlmExtractionService`, which validates every provider response before returning data to downstream services.
- The implementation is provider-neutral. Business logic receives parsed contract data and does not depend on a concrete model name.

## Run Metadata

Every provider call writes an `llm_runs` record with:

- operation
- provider
- model
- prompt version
- schema version
- temperature
- SHA-256 input hash
- compact output summary
- status and error message where applicable

The run log intentionally stores input hashes, document IDs, and text lengths rather than full document text. This keeps runs auditable without copying unnecessary copyrighted source text into logs.

## Validation Boundary

Invalid provider output is rejected before it can create entities, entity resolutions, claims, or evidence. The Phase 5 tests cover:

- mocked provider execution through the abstraction
- entity extraction schema validation
- invalid entity and relation output rejection
- successful and failed LLM run logging without source-text persistence
