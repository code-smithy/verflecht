# Lobbywatch import

Lobbywatch is the second external source. Its public export adds declared interests, professional and organisational mandates, and parliamentary access badges. Lobbywatch is an organisation source, not an official primary source, so every generated relationship has status `PENDING_REVIEW`; the adapter never publishes or verifies its own claims.

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
```

An interrupted download leaves `lobbywatch-export.zip.part` and resumes with an HTTP range request. A server that does not honor ranges causes a safe full restart. Conditional requests avoid replacing an unchanged completed snapshot. Changed completed ZIPs are retained under `data/raw/lobbywatch/versions/`.

The generated `data/imports/lobbywatch/research.json` is merged by the normal offline build. Because all claims are candidates, importing alone does not change the public graph. Verification remains a separate human-reviewed edit with source evidence and review metadata.
