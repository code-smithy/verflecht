# Swiss Parliament import

## Parliamentary affairs

The normaliser reads cached `affairs/{id}` details discovered in the `affairs` lists. It creates `PARLIAMENTARY_AFFAIR` entities and automatically publishes `AUTHORED` and `CO_SIGNED` links from explicit `author` and `cosign` roles. Individual authors reuse councillor IDs; committee and faction authors reuse their catalogue IDs. A faction listed beside an individual author is context, not another author. Correspondents, names in free text, and unsupported roles do not produce links.

German details provide evidence. Translated titles are retained without duplicate links. Missing detail responses are skipped until a later import downloads them; malformed author identities are counted in `skipped_affairs`. The report includes `affair_detail_responses`, `authorship_claims`, and `cosignatory_claims`. Rebuilding replaces removed source roles. Authorship dates remain unknown; the filing date is not treated as a membership period.

This extends automatic publication beyond the memberships described below. Votes and topic/indexing-code mappings remain outside this release. No new network requests or workflow changes are required: the nightly job normalises the available archive and publishes its graph. The viewer's relationship filter includes the new predicates when data is present.

## Party and faction affiliations

The normaliser also publishes `MEMBER_OF` links from active councillors to their explicitly identified party and faction. It uses `partyId`/`partyName` and `factionId`/`factionName` from the German detail response. IDs match the party and faction catalogue entities; translations do not create duplicate links.

These are source snapshots, not membership histories. Both validity dates remain unknown. Inactive members, missing IDs, and missing names do not produce these links. The evidence contains the member ID, active flag, and exact affiliation fields. Free text, motions, and votes remain excluded. Each successful normalisation rebuilds the snapshot, so removed affiliations are not retained as current facts.

Run `python import_parliament.py --normalize-only` against an existing archive to generate the new links without downloading the archive again. The nightly import runs normalisation automatically. The automatic-publication scope described below now also includes these active-member party/faction links.

The source is [the Swiss Parliament's public web service](https://ws-old.parlament.ch/). The importer uses the documented JSON format, `lang` parameter, and `pageNumber` pagination. It identifies itself as Verflecht and sends `Accept: text/json`; requests without the documented format header may be rejected by the service.

## Scope

The default import includes German, French, Italian, and English, with no date, legislature, or active-person filter. It archives all accessible JSON records and detail responses from:

- Councillors, basic details, and historical membership records.
- Committees, councils, cantons, parties, factions, and departments, including historical views.
- Legislative periods and sessions.
- Affairs, affair summaries, types, states, topics, and descriptors.
- Both vote views: by affair and by councillor, including nested individual decisions.

The API's `/parties` default endpoint returns 404; `/parties/historic` is available. `/votes` has no default dataset; its two implemented views are imported. These exceptions are recorded in every coverage report. “All” means the data exposed by this legacy JSON service; linked external PDFs, photos, websites, and records absent from the service are not independently crawled.

The service reports more than 67,000 affairs, with a separate detail request for each language version. The first archive is a substantial download and may require several jobs. A successful bounded job can be `paused`; only a manifest with `status: complete` confirms all discovered listing pages and details have succeeded.

## Local commands

```sh
python import_parliament.py --refresh
python import_parliament.py --status
python import_parliament.py --normalize-only
python build_data_pipeline.py
```

`--refresh` starts a new listing cycle after a completed import. Interrupted cycles resume from their existing pages. Each primary listing's `updated` value determines whether its detail needs downloading again. Historical views generate request-time timestamps, so the importer prefers revisions from the primary listing for shared detail IDs. Changes that the upstream service fails to reflect in its revision timestamps require a fresh snapshot (`--archive data/raw/parliament-new`).

Useful options:

```sh
python import_parliament.py --max-seconds 14400
python import_parliament.py --max-requests 100
python import_parliament.py --languages de fr it en --workers 4 --interval 0.2
```

The default rate is at most five request starts per second across four workers, reduced further by response latency, `robots.txt`, retries, and `Retry-After`. Access denial stops the run. No credentials or access-control bypass is used. Pausing at an explicit request/time limit exits successfully so the workflow can save its checkpoint; other incomplete or blocked imports exit unsuccessfully. The report distinguishes these outcomes.

## Files

- `data/raw/parliament/responses/`: compressed JSON envelopes containing the exact decoded API body, URL, language, retrieval time, and SHA-256 checksum. Raw history is retained under `versions/` when a response changes.
- `data/raw/parliament/manifest.json`: progress, collection counts, detail totals, and errors. Counts refer to each language/view and can include the same underlying record in multiple views.
- `data/raw/parliament/catalog.json`: detail request inventory after listing discovery.
- `data/imports/parliament/research.json`: normalized entities, council/committee memberships, and active-member party/faction affiliations.
- `data/imports/parliament/normalization-report.json`: normalization counts and skipped membership records.

Normalized research and the public graph use size-bounded JSON storage. Exports up to 32 MiB remain a single JSON object. Larger exports replace `research.json` or `graph.json` with a `json-parts-v1` manifest; its `parts` map lists collection arrays in adjacent `research.parts/` or `graph.parts/` directories. Each file is at most 32 MiB, measured as UTF-8 bytes. Part names contain their SHA-256 hash. The pipeline reads both formats, verifies research part hashes, and checks every generated graph part with `--check`. The website loads graph parts before validating the complete graph. All records and evidence are retained; an individual record exceeding the limit fails explicitly.

Keep each manifest together with its parts when copying or downloading normalized data. Python consumers can use `pipeline.json_store.read_dataset(path)` to read either format. A successful rebuild removes obsolete generated parts. Chunking addresses GitHub's per-file limit; the browser still loads the complete graph, so total download size and browser memory remain proportional to the dataset.

The full archive retains every returned field, including multilingual texts, historical rows sharing a councillor ID, affair data, votes, and declared interests. The smaller research projection currently maps people, institutions, council/committee memberships, and active-member party/faction affiliations. It does not infer affiliations from vote similarity, co-mentions, party abbreviations, or free-text disclosures. German membership excerpts supply evidence; entity names retain translations.

Explicit council and committee memberships and active-member party/faction affiliations returned by the official API are marked `VERIFIED` automatically with `automatic:ch-parliament-official-api` provenance and are published. This exception applies only to direct structured membership records. Votes, free text, co-mentions, and derived or inferred affiliations are not automatically published. The full normalised dataset is committed under `data/imports/parliament/`; generated files should not be edited. Authored records in `data/research.json` take precedence, so they can reject or correct an imported claim with the same ID. A custom `--input` remains standalone.

Raw archives are ignored by Git and excluded from the website; normalised imports are committed. They may include publicly returned contact information; only explicitly selected evidence fields can enter the public graph.

## GitHub Actions

The nightly schedule remains **01:17 UTC**. It starts four separate jobs (`de`, `fr`, `it`, `en`) in parallel. Each has its own four-hour import budget, resumable cache, normalized result, archive artifact, and coverage summary. Failure in one language does not cancel the others. Publication waits for all selected language jobs to succeed; a paused import is a successful checkpoint, not a complete archive.

For a quick test, open **Actions → Import Swiss Parliament → Run workflow**:

- Select `de` (the manual default), or another language, or `all`.
- Set `max_seconds` between 60 and 14400. Manual runs default to 900 seconds (15 minutes).
- A single-language run uses the existing five-request-starts-per-second limit. Four-language runs share that aggregate limit through a 0.8-second interval per job.
- Branch runs upload results for review. Only main runs commit data and dispatch Pages CI.

The time budget limits network work; checkout, cache transfer, normalization and uploads add runtime. Splitting languages avoids waiting for unrelated languages in a German-only test. It does not guarantee that the initial German archive completes within the budget.

Language caches use `parliament-v2-<language>-` keys. Each runner uses the same local archive path but is isolated from the other runners. On the first split run, a legacy `parliament-v1-` cache can seed the job without downloading the existing responses again. It may contain other languages' cached responses; only the selected language is requested and normalized. If caches have expired, the job must fetch its archive again.

One publication job combines the selected results with committed snapshots under `data/imports/parliament/languages/<language>/`. It then rebuilds the canonical `data/imports/parliament/research.json` and public graph. Existing published data seeds missing snapshots during migration. German supplies verified claims and preferred entity names; other languages contribute translated names. A French-only run cannot remove German claims. A German-only run preserves the last saved translations. Snapshot timestamps may differ.

1. Tests the Python pipeline.
2. Restores the last archive checkpoint from the Actions cache.
3. Imports all four languages for up to four hours, then normalizes available records.
4. Validates/builds the public graph, including explicit official memberships.
5. Saves a new cache checkpoint and uploads the raw archive, normalized research, and coverage reports as a `parliament-import-<run ID>` artifact retained for seven days.
6. Writes collection/detail coverage to the run summary.
7. Checks generated file sizes before committing, then commits the full normalised dataset, generated public graph, and all required parts (including removal of obsolete parts) when they change. Dispatches the Pages CI workflow after a successful push.
8. Stops after saving its checkpoint. If the archive is paused, the next nightly run resumes it. The workflow never self-dispatches an import continuation.
   Successful language results are uploaded separately as `parliament-result-<language>`; archives as `parliament-archive-<language>`; combined data as `parliament-combined`. Artifacts are retained for seven days. Cache saving and archive upload are attempted even when an import fails. A failed selected job prevents publication of the whole run.

For local language-isolated work:

```sh
python import_parliament.py --languages de --archive data/raw/parliament-de --output data/raw/results/de/research.json --refresh --max-seconds 900
python -m pipeline.language_import combine data/raw/results data/imports/parliament
python build_data_pipeline.py
```

Use a separate archive and output directory for each language. The workflow serializes runs on the same branch to avoid competing publication jobs. A concurrent unrelated push to main can reject the publication push; it is not force-pushed.

If an older run failed to push oversized single-file exports, deploy this storage change before dispatching the import again. The next run restores the archive checkpoint and rebuilds normalized output in the bounded format. The rejected commit never reached `main`, so that rejection alone requires no Git history rewrite. If its cache has been evicted, restore `data/raw/parliament/` from the failed run's artifact to reuse that archive locally; the workflow does not automatically restore artifacts.
