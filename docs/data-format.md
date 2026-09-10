# Local data format (version 1)

`data/research.json` contains `schema_version: 1` and four arrays: `sources`, `documents`, `entities`, and `claims`. All arrays may be empty. IDs are non-empty strings, unique within each collection and stable across builds. References must resolve. Names and IDs are trimmed; document text remains exact. Optional internal fields are allowed but excluded from public output.

## Sources

Required: `id`, `name`, `type`, `url`.

| Type           | Meaning                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `official`     | Government, parliament, or official registers                            |
| `organisation` | A company, association, party, or organisation's own material            |
| `media`        | Journalism and reporting                                                 |
| `other`        | Other attributable material, including manual research with a source URL |

These describe who published the material, not its file format, reliability score, or import mechanism. URLs must be HTTP(S), without embedded credentials. There are no crawler settings yet.

## Documents

Required: `id`, `source_id`, `title`, `url`, `text`.

A document is a specific source version. Keep its text unchanged once cited; add a new document ID for updated material. The pipeline computes a SHA-256 hash of exact UTF-8 text and includes that hash in evidence metadata. Raw files may be stored in `data/raw/`; they are not read or published automatically. Hashes identify content; the pipeline does not fetch, extract, or deduplicate documents automatically.

## Entities

Required: `id`, `name`, `type`. Allowed entity types are in `data/ontology.json`. Events remain their own entities. Internal aliases or notes may be stored as additional fields; they are not automatically resolved or published.

## Claims

Required: `id`, `subject_id`, `object_id`, `predicate`, `connection_class`, `status`.

- Predicates, connection classes, and statuses use the values in `data/ontology.json`.
- `evidence` is an array of `{ "document_id": "...", "text": "exact excerpt" }`. Each excerpt must occur in that document's text, and the document must reference a source.
- Only `VERIFIED` claims are exported. They require at least one evidence item, `reviewed_by` (non-empty reviewer name/ID), and `reviewed_at` (ISO timestamp with timezone).
- Optional `valid_from` and `valid_to` use `YYYY-MM-DD` or null. Start cannot follow end. `HISTORICAL` requires an end date. Dates are preserved; the pipeline does not infer whether a relationship is current from an absent end date.
- `PARTICIPATED_IN` and `SPOKE_AT` require an event object. `ORGANISED_BY` requires an event subject. Other predicate semantics are a reviewer responsibility for now.
- To correct a published claim, retain it and add a new claim with `supersedes_id`. A verified replacement removes its predecessors from the export; a pending replacement leaves the previous verified claim visible. Cycles and competing verified replacements are rejected. To withdraw a claim without replacement, set its status to `DISPUTED`, `REJECTED`, or `OUTDATED` and retain the change in version control.

Review is currently manual JSON editing with Git history, not an authenticated workflow. The pipeline checks review metadata and literal evidence, but cannot establish that a review happened or that an excerpt logically proves a relationship. It never assigns `VERIFIED` itself. Use Git diffs to review changes and preserve authorship/history.

See [the fictional test fixture](../tests/fixtures/research.json) for a complete record set. Fixtures are not included in the real dataset.

## Public export

`public/data/graph.json` has `schema_version`, `nodes`, and `edges`.

- Nodes: only `id`, `name`, and `type`, and only when connected to a published edge.
- Edges: `id`, `subject_id`, `object_id`, `predicate`, `connection_class`, `valid_from`, `valid_to`, and `evidence`.
- Evidence: excerpt `text`, document (`id`, `title`, `url`, `source_id`, `content_hash`), and source (`id`, `name`, `type`, `url`).

The viewer reads `/data/graph.json` and validates its shape. There is no database or server API. Source/document text and review details stay in the authoring file. Output uses explicit field allowlists; adding internal fields does not make them public. Collection ordering is stable by ID. Builds use an atomic replacement after validation, and `--check` compares the expected bytes with the committed export.

Future source importers should write local candidates in this format with `PENDING_REVIEW`, then run the same build. Keep network fetching separate from the offline build. Nothing in this version calls remote sources or an LLM.
