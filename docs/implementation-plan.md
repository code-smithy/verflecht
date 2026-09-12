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
- Run one job per language in parallel, each bounded to four hours, then save its checkpoint and stop.
- Resume an incomplete archive during the next nightly run.
- Manual dispatch selects one language or all languages and defaults to a 15-minute budget; no self-dispatched continuations.

## Implemented: Lobbywatch source adapter

- Download and resume Lobbywatch's weekly aggregated JSON export.
- Join parliamentarians to official Parliament entities using stable biography IDs.
- Generate evidence-backed, `PENDING_REVIEW` candidates for interests, mandates, and access badges.
- Preserve CC BY-SA provenance and exclude contact/address fields from generated candidates.
- Preserve changed and removed candidate versions, and promote explicit review decisions into authored research.
- Refresh candidates in a weekly GitHub Action without automatically publishing them.

Next, add a reviewer-friendly claim triage interface over the explicit promotion contract.

## Next: add further sources

All multilingual adapters must use separate language jobs, checkpoints and snapshots, with single-language manual runs and all-language nightly runs. Follow [the import conventions](import-conventions.md). Parliament now follows this model.

1. Add source-specific Python adapters behind the same nightly, checkpointed operating model.
2. Test unchanged imports, changed versions, and failure recovery for every adapter.

## Later: research workflow and viewer

- Add source-specific extraction and optional LLM candidate generation only as needed.
- Add a review UI if manual JSON editing becomes cumbersome. Preserve the rule that candidates cannot publish themselves.
- Improve entity resolution with explicit ambiguity handling.
- Add graph interaction, search, filters, and timelines over the same public JSON contract.
- Add stronger history enforcement and concurrent editing only if the local workflow requires them.

The Swiss Parliament adapter now archives the legacy API in all four languages, resumes interrupted imports on the next nightly run, and refreshes changed records. See [the importer documentation](parliament-import.md). Supabase, login, LLM providers, and multi-user services are intentionally absent.
