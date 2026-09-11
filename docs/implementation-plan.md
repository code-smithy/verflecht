# Implementation plan

## Implemented: login-free file pipeline

- Replace Supabase, hosted database configuration, authentication, and login flows with `data/research.json` and generated local files.
- Keep a shared controlled vocabulary in `data/ontology.json`; simplify source types to four publisher categories.
- Add `python build_data_pipeline.py`: offline validation, evidence matching, review requirements, supersession checks, and deterministic atomic public export.
- Separate authored research from `public/data/graph.json` through explicit field projection.
- Connect the web shell to generated JSON with loading, empty, failure, and evidence-backed relationship states.
- Rebuild automatically before development and production builds.
- Add Python tests and a shared export fixture checked by the TypeScript consumer; enforce data freshness in CI.
- Document local authoring, review, correction, rebuild, and deployment commands.

## Implemented: nightly collection

- Run the Parliament importer once per night at 01:17 UTC.
- Keep each import bounded to four hours, then save its checkpoint and stop.
- Resume an incomplete archive during the next nightly run.
- Keep manual dispatch available as one bounded run without self-dispatching a continuation.

## Next: add further sources

1. Add source-specific Python adapters behind the same nightly, checkpointed operating model.
2. Test unchanged imports, changed versions, and failure recovery for every adapter.

## Later: research workflow and viewer

- Add source-specific extraction and optional LLM candidate generation only as needed.
- Add a review UI if manual JSON editing becomes cumbersome. Preserve the rule that candidates cannot publish themselves.
- Improve entity resolution with explicit ambiguity handling.
- Add graph interaction, search, filters, and timelines over the same public JSON contract.
- Add stronger history enforcement and concurrent editing only if the local workflow requires them.

The Swiss Parliament adapter now archives the legacy API in all four languages, resumes interrupted imports on the next nightly run, and refreshes changed records. See [the importer documentation](parliament-import.md). Supabase, login, LLM providers, and multi-user services are intentionally absent.
