# Language-separated import jobs

All future multilingual source importers must follow this contract:

1. Run one isolated job per language. Nightly runs select all supported languages; manual runs can select one language and a bounded runtime.
2. Use source- and language-specific checkpoint keys, artifacts and normalized snapshots. One language must never share mutable progress with another job.
3. Resume incomplete work independently. A failure must not cancel other language jobs or replace published data with failed output.
4. Keep the aggregate source request rate within the source's limit when jobs run in parallel.
5. Publish through one aggregation job. Merge selected results with the last successful snapshots of unselected languages. Do not erase other languages on a partial-language run.
6. Deduplicate entity and relationship IDs across translations. Define the source's evidence-language policy explicitly. Parliament currently uses German claims and translated entity names.
7. Publish only after all selected jobs succeed and validation passes. Branch runs produce review artifacts; main runs may commit and dispatch site CI.
8. Include source/language progress and retrieval dates in reports. Document cache migration and recovery.

The Parliament workflow and `pipeline.language_import.configuration` provide the initial selection/budget pattern. Its `combine` implementation is Parliament-specific: another source must define its own evidence policy rather than inherit German-only publication by accident.
