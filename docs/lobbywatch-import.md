# Lobbywatch import

Lobbywatch is the second external source. Its public export adds declared interests, professional and organisational mandates, and parliamentary access badges. Lobbywatch is an organisation source, not an official primary source, so its generated relationships have status `PENDING_REVIEW`; the adapter never verifies its own claims. A separate corroborator publishes only the subset that exactly matches structured declarations fetched directly from the official Parliament API.

The adapter downloads Lobbywatch's weekly aggregated JSON ZIP from the [data export page](https://lobbywatch.ch/datenexport/). Lobbywatch documents the export as CC BY-SA 4.0. The unchanged ZIP, its SHA-256 checksum, retrieval metadata, and replaced versions stay in ignored `data/raw/lobbywatch/`.

## Identity and relationships

Every exported parliamentarian is joined to the existing Swiss Parliament person entity using Lobbywatch's `parlament_biografie_id`. The adapter does not use names as identity proof. Records without that stable ID are reported and skipped.

The initial conservative mapping is:

| Lobbywatch record                                       | Candidate predicate                  |
| ------------------------------------------------------- | ------------------------------------ |
| President / vice-president                              | `PRESIDENT_OF` / `VICE_PRESIDENT_OF` |
| Board role (`vorstand`)                                 | `BOARD_MEMBER_OF`                    |
| Operational employment (`taetig`, `geschaeftsfuehrend`) | `EMPLOYED_BY`                        |
| Ownership role (`gesellschafter`)                       | `SHAREHOLDER_OF`                     |
| Other declared interests and mandates                   | `HAS_MANDATE_AT`                     |
| Parliamentarian grants an access badge                  | `ISSUED_ACCESS_BADGE_TO`             |

Explicit source dates are retained. Ended relationships are marked `HISTORICAL`; relationships created as an authority representative are classified `OFFICIAL`. The classification does not change the review requirement.

Only selected relationship fields are serialized into evidence documents. Private contact and address fields in the export are not copied into the generated dataset. Organisation and badge-person IDs retain a `lobbywatch:` namespace. The report lists malformed or unresolved rows rather than guessing.

## Commands

```sh
python import_lobbywatch.py
python import_lobbywatch.py --status
python import_lobbywatch.py --normalize-only
python verify_lobbywatch.py
```

An interrupted download leaves `lobbywatch-export.zip.part` and resumes with an HTTP range request. A server that does not honor ranges causes a safe full restart. Conditional requests avoid replacing an unchanged completed snapshot. Changed completed ZIPs are retained under `data/raw/lobbywatch/versions/`.

The generated `data/imports/lobbywatch/research.json` is merged by the normal offline build. Because all of its claims are candidates, importing alone does not change the public graph. `verify_lobbywatch.py` fetches each matched officeholder's current official `concerns` array and writes independently evidenced claims to `data/imports/lobbywatch-verified/research.json`. The normal build discovers that generated import automatically.

Automatic corroboration requires exactly one current Lobbywatch interest with the same Parliament biography ID, normalized organisation name, and explicitly mapped role. It does not use fuzzy matching, does not copy Lobbywatch dates into official claims, and does not verify access badges. Unmatched, ambiguous, and unsupported roles stay private and are counted in `data/imports/lobbywatch-verified/verification-report.json`; its Markdown companion appears in the Action summary and on the review branch.

Each relationship uses its Lobbywatch record ID as a stable lineage and its normalized contents as a version ID. When a record changes, the new candidate supersedes the previous version. When it disappears from Lobbywatch's current-parliament export, the previous version and its evidence remain in the generated dataset as `OUTDATED`. A later reappearance cannot create a supersession cycle.

Generated imports must not be edited. Record a review decision in authored `data/research.json` instead:

```sh
python review_lobbywatch.py --decision VERIFIED --reviewer "reviewer-id" "lobbywatch:claim:..."
python review_lobbywatch.py --decision REJECTED --reviewer "reviewer-id" "lobbywatch:claim:..."
```

The command copies the claim, its exact evidence document, source attribution, and referenced entities into authored research, adds review metadata, validates the fully merged graph, and then writes atomically. It refuses to overwrite an existing authored decision. Later imports cannot replace authored records with the same ID.

## GitHub Actions

`Import Lobbywatch` runs at 04:41 UTC each Monday, after Lobbywatch's documented early-Monday export refresh. It restores the raw checkpoint, resumes or conditionally checks the export, generates candidates, fetches official Parliament declarations, creates exact verified matches, rebuilds the graph, saves the checkpoint, and uploads the raw archive and reports for 14 days. Meaningful changes are committed to the reusable `codex/lobbywatch-refresh` review branch instead of being pushed directly to `main`. The Action dispatches CI for that branch and puts a one-click compare/pull-request link in its summary. An already-open pull request updates automatically; after it has been merged, the next meaningful refresh needs one click to open the new review. Merging publishes the static site through the normal `main` build.

The Action never treats Lobbywatch as verification. New officeholders join automatically through `parlament_biografie_id`; only unique exact matches receive separate official `VERIFIED` claims with `automatic:ch-parliament-official-api` provenance. Ambiguous or incomplete records are reported. The raw cache retains replaced ZIPs, while generated claims that lose their exact official match are retained as non-public `OUTDATED` history.
