# Verflecht

Source-backed political network research with Python ingestion and projection pipelines and a login-free Next.js viewer. The application deliberately uses no Supabase database, Supabase Storage, authentication service, or login. Source imports fetch data in scheduled Python jobs; the deterministic projection build itself remains offline.

## Quick start

Requirements: Python 3.10+ (`python` on PATH), Node.js 22+, and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
python build_data_pipeline.py
pnpm dev
```

Open [localhost:3000](http://localhost:3000). The dataset starts empty; add sources and research later. `pnpm dev` and `pnpm build` rebuild data automatically. After changing research while the dev server is running, rerun the pipeline and reload the page.

## Data workflow

```text
data/research.json → Python validation and projection → public/data/graph.json → web viewer
```

- Edit `data/research.json`: the source of truth for sources, documents, entities, and claims.
- `data/ontology.json` contains shared controlled values. Source types are `official`, `organisation`, `media`, and `other`. File formats such as PDF are not source types.
- Run `python build_data_pipeline.py`. Only verified, source-backed relationships and their connected entities enter the public export.
- Review the JSON diff before committing. Keep old document versions and claims; use new IDs and `supersedes_id` for corrections.
- `public/data/graph.json` is generated and checked in. Do not edit it directly.
- Optional raw files belong in ignored `data/raw/`, outside the web root. Full document text, review metadata, and internal notes are never copied into the public export. Files committed to a public repository are still public; this export boundary is not repository access control.

The pipeline follows the local build and browser-ready export pattern of [russianinfra](https://github.com/code-smithy/russianinfra). The build itself stays offline. The [Swiss Parliament importer](docs/parliament-import.md) separately archives all four language versions. It automatically publishes only explicit council and committee memberships returned by the official API. It does not infer relationships from votes, text, or co-occurrence.

The importer runs once per night. Each run restores its checkpoint, collects data for a bounded period, saves its progress, commits the full normalised dataset and public graph, and stops. If the initial Parliament archive is incomplete, the next nightly run resumes it. A data change triggers the Pages build.

## Commands

```sh
python build_data_pipeline.py                         # Validate and atomically rebuild
python build_data_pipeline.py --check                 # Validate and detect stale exports; no writes
python build_data_pipeline.py --input path/to/research.json --output path/to/graph.json
pnpm test:pipeline                                   # Python standard-library tests
pnpm data:import:parliament                           # Import/refresh all Parliament records
pnpm test                                            # Frontend data-contract tests
pnpm typecheck
pnpm lint
pnpm format
pnpm build
pnpm start
```

Default data paths are relative to the repository, even when the Python command is run from another directory. Explicit paths are relative to the working directory. Invalid input exits with an error and leaves the last successful export intact. Rebuild successfully before publishing; CI rejects stale or invalid data.

See [the data format](docs/data-format.md), [requirements](docs/requirements.md), and [implementation plan](docs/implementation-plan.md).

## GitHub Pages

The CI workflow tests and statically exports the app, then deploys successful `main` builds to [the public site](https://code-smithy.github.io/verflecht/). It can also be run manually. Pull requests only validate the build.

Pages builds set `NEXT_OUTPUT=export` and `NEXT_PUBLIC_SITE_BASE_PATH=/verflecht` so scripts and research JSON load under the repository path. Normal local development needs neither variable. The deployed app has no login, account service, or authenticated routes.
