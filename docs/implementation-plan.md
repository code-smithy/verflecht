# Implementation plan

## Implemented: local backend foundation

- Replace the hosted database dependency and configuration with `data/research.json`.
- Keep a shared controlled vocabulary in `data/ontology.json`; simplify source types to four publisher categories.
- Add `python build_data_pipeline.py`: offline validation, evidence matching, review requirements, supersession checks, and deterministic atomic public export.
- Separate authored research from `public/data/graph.json` through explicit field projection.
- Connect the web shell to generated JSON with loading, empty, failure, and evidence-backed relationship states.
- Rebuild automatically before development and production builds.
- Add Python tests and a shared export fixture checked by the TypeScript consumer; enforce data freshness in CI.
- Document local authoring, review, correction, rebuild, and deployment commands.

## Next: add sources when selected

1. Choose the first actual source and capture representative local fixtures.
2. Implement a small Python adapter that produces candidate records, preserving source URLs and document versions.
3. Keep source refresh explicit and separate from offline rebuilding.
4. Test unchanged imports, changed versions, and failure recovery before adding scheduled execution.

## Later: research workflow and viewer

- Add source-specific extraction and optional LLM candidate generation only as needed.
- Add a review UI if manual JSON editing becomes cumbersome. Preserve the rule that candidates cannot publish themselves.
- Improve entity resolution with explicit ambiguity handling.
- Add graph interaction, search, filters, and timelines over the same public JSON contract.
- Add stronger history enforcement and concurrent editing only if the local workflow requires them.

No source integrations, remote refresh jobs, LLM providers, or multi-user services are configured in this version.
