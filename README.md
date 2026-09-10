# Verflecht

Source-backed political network research with an offline Python pipeline and a Next.js viewer. No database, cloud account, API keys, or Python packages are required.

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

The pipeline follows the local build and browser-ready export pattern of [russianinfra](https://github.com/code-smithy/russianinfra). It does not fetch remote sources. Source adapters, crawling, LLM extraction, and a review UI can be added later.

## Commands

```sh
python build_data_pipeline.py                         # Validate and atomically rebuild
python build_data_pipeline.py --check                 # Validate and detect stale exports; no writes
python build_data_pipeline.py --input path/to/research.json --output path/to/graph.json
pnpm test:pipeline                                   # Python standard-library tests
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
