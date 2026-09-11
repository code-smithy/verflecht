# Swiss Parliament import

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

The full archive retains every returned field, including multilingual texts, historical rows sharing a councillor ID, affair data, votes, and declared interests. The smaller research projection currently maps people, institutions, council/committee memberships, and active-member party/faction affiliations. It does not infer affiliations from vote similarity, co-mentions, party abbreviations, or free-text disclosures. German membership excerpts supply evidence; entity names retain translations.

Explicit council and committee memberships and active-member party/faction affiliations returned by the official API are marked `VERIFIED` automatically with `automatic:ch-parliament-official-api` provenance and are published. This exception applies only to direct structured membership records. Votes, free text, co-mentions, and derived or inferred affiliations are not automatically published. The full normalised dataset is committed under `data/imports/parliament/`; generated files should not be edited. Authored records in `data/research.json` take precedence, so they can reject or correct an imported claim with the same ID. A custom `--input` remains standalone.

Raw archives are ignored by Git and excluded from the website; normalised imports are committed. They may include publicly returned contact information; only explicitly selected evidence fields can enter the public graph.

## GitHub Actions

The intended operating model is one **Import Swiss Parliament** run each night at **01:17 UTC** (02:17 in Zurich in winter, 03:17 in summer). It can also be dispatched manually. GitHub may delay scheduled runs. A scheduled or manual invocation must perform one bounded run, save its checkpoint, and then stop; incomplete work resumes on the next nightly invocation.

Each run:

1. Tests the Python pipeline.
2. Restores the last archive checkpoint from the Actions cache.
3. Imports all four languages for up to four hours, then normalizes available records.
4. Validates/builds the public graph, including explicit official memberships.
5. Saves a new cache checkpoint and uploads the raw archive, normalized research, and coverage reports as a `parliament-import-<run ID>` artifact retained for seven days.
6. Writes collection/detail coverage to the run summary.
7. Commits the full normalised dataset and generated public graph when they change, then dispatches the Pages CI workflow.
8. Stops after saving its checkpoint. If the archive is paused, the next nightly run resumes it. The workflow never self-dispatches an import continuation.

A concurrency group prevents simultaneous import jobs. A local archive lock also prevents two processes from writing the same cache. The nightly job commits normalised data, not the raw archive, under the public site's publication policy. Download its artifact to use the archived data locally. Cache eviction can require a new archive; the uploaded artifacts provide a separate recovery copy.
