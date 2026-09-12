import io
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
import zipfile

from pipeline.json_store import read_dataset
from pipeline.lobbywatch import (DATA_MEMBER, EXPORT_FILENAME, SOURCE,
                                 download_export, materialize, validate_archive)
from pipeline.lobbywatch_review import review_claims
from pipeline.lobbywatch_verify import canonical_name, concern_predicate, corroborate


def export_bytes(records):
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(DATA_MEMBER, json.dumps(records, ensure_ascii=False))
    return result.getvalue()


class Response(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body)
        self.status = status
        self.headers = headers or {}

    def getcode(self):
        return self.status


class LobbywatchTests(unittest.TestCase):
    def fixture(self):
        organisation = {
            "id": 20, "name_de": "Beispiel AG", "name_fr": "Exemple SA",
            "rechtsform": "AG", "uid": "CHE-1",
        }
        interest = {
            "id": 30, "parlamentarier_id": 10, "organisation_id": 20,
            "art": "vorstand", "funktion_im_gremium": "praesident",
            "von": "2020-01-01", "bis": None, "aktiv": 1,
            "organisation": organisation,
        }
        mandate = {
            "id": 50, "person_id": 40, "organisation_id": 20,
            "art": "taetig", "funktion_im_gremium": None,
            "von": "2018-01-01", "bis": "2022-12-31",
            "organisation": organisation,
        }
        badge = {
            "id": 60, "zutrittsberechtigung_id": 60, "person_id": 40,
            "parlamentarier_id": 10, "name_de": "Alex Beispiel",
            "funktion": "Interessenvertretung", "von": "2023-01-01", "bis": None,
            "mandate": [mandate],
        }
        return [{
            "id": 10, "parlament_biografie_id": 4051,
            "name_de": "Thomas Beispiel", "name_fr": "Thomas Exemple",
            "interessenbindungen": [interest], "zutrittsberechtigungen": [badge],
        }]

    def test_partial_download_resumes_and_validates(self):
        payload = export_bytes(self.fixture())
        with tempfile.TemporaryDirectory() as directory:
            partial = Path(directory) / (EXPORT_FILENAME + ".part")
            offset = len(payload) // 2
            partial.write_bytes(payload[:offset])

            def opener(request, timeout):
                self.assertEqual(timeout, 60)
                self.assertEqual(request.headers["Range"], f"bytes={offset}-")
                return Response(payload[offset:], 206, {
                    "Content-Range": f"bytes {offset}-{len(payload) - 1}/{len(payload)}",
                    "Content-Length": str(len(payload) - offset), "ETag": '"fixture"',
                })

            state = download_export(directory, "https://example.test/export.zip", opener)

            self.assertEqual(state["status"], "complete")
            self.assertEqual((Path(directory) / EXPORT_FILENAME).read_bytes(), payload)
            self.assertFalse(partial.exists())
            validate_archive(Path(directory) / EXPORT_FILENAME)

    def test_unchanged_download_is_conditional_and_changed_version_is_retained(self):
        first = export_bytes(self.fixture())
        changed_fixture = self.fixture()
        changed_fixture[0]["name_de"] = "Geänderter Name"
        changed = export_bytes(changed_fixture)
        url = "https://example.test/export.zip"
        with tempfile.TemporaryDirectory() as directory:
            download_export(
                directory, url,
                lambda _request, timeout: Response(first, 200, {"ETag": '"v1"'}),
            )

            def unchanged(request, timeout):
                self.assertEqual(request.get_header("If-none-match"), '"v1"')
                raise HTTPError(url, 304, "Not Modified", {}, None)

            state = download_export(directory, url, unchanged)
            self.assertIn("checked_at", state)

            download_export(
                directory, url,
                lambda _request, timeout: Response(changed, 200, {"ETag": '"v2"'}),
            )
            old_digest = hashlib.sha256(first).hexdigest()
            self.assertEqual(
                (Path(directory) / "versions" / f"{old_digest}.zip").read_bytes(), first,
            )
            self.assertEqual((Path(directory) / EXPORT_FILENAME).read_bytes(), changed)

    def test_materialize_joins_parliament_ids_and_keeps_candidates_private(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "raw"
            archive.mkdir()
            (archive / EXPORT_FILENAME).write_bytes(export_bytes(self.fixture()))
            output = Path(directory) / "research.json"

            report = materialize(archive, output)
            dataset = read_dataset(output)

            self.assertEqual(report["candidate_claims"], 3)
            self.assertEqual(report["interests"], 1)
            self.assertEqual(report["badges"], 1)
            self.assertEqual(report["badge_mandates"], 1)
            self.assertEqual(dataset["sources"], [SOURCE])
            self.assertIn("parliament:person:4051", {item["id"] for item in dataset["entities"]})
            self.assertEqual({item["status"] for item in dataset["claims"]}, {"PENDING_REVIEW"})
            self.assertEqual(
                {item["predicate"] for item in dataset["claims"]},
                {"PRESIDENT_OF", "EMPLOYED_BY", "ISSUED_ACCESS_BADGE_TO"},
            )
            # PENDING_REVIEW candidates validate but produce no public edges.
            from pipeline.build import project
            self.assertEqual(project(dataset)["edges"], [])

    def test_changed_and_removed_candidates_keep_a_historical_lineage(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "raw"
            archive.mkdir()
            output = Path(directory) / "research.json"
            first = self.fixture()
            (archive / EXPORT_FILENAME).write_bytes(export_bytes(first))
            materialize(archive, output)
            original = read_dataset(output)
            original_interest = next(item for item in original["claims"]
                                     if item["lineage_id"] == "lobbywatch:interests:30")

            changed = self.fixture()
            changed[0]["interessenbindungen"][0]["funktion_im_gremium"] = "vizepraesident"
            changed[0]["zutrittsberechtigungen"] = []
            (archive / EXPORT_FILENAME).write_bytes(export_bytes(changed))
            report = materialize(archive, output)
            current = read_dataset(output)
            lineage = [item for item in current["claims"]
                       if item["lineage_id"] == "lobbywatch:interests:30"]

            self.assertEqual(len(lineage), 2)
            replacement = next(item for item in lineage if item["status"] == "PENDING_REVIEW")
            self.assertEqual(replacement["predicate"], "VICE_PRESIDENT_OF")
            self.assertEqual(replacement["supersedes_id"], original_interest["id"])
            self.assertEqual(next(item for item in lineage if item["id"] == original_interest["id"])["status"],
                             "OUTDATED")
            self.assertEqual(report["retained_outdated_claims"], 3)

    def test_review_decisions_are_copied_to_authored_research(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "raw"
            archive.mkdir()
            imported_path = Path(directory) / "imported.json"
            authored_path = Path(directory) / "authored.json"
            (archive / EXPORT_FILENAME).write_bytes(export_bytes(self.fixture()))
            materialize(archive, imported_path)
            imported = read_dataset(imported_path)
            authored_path.write_text(json.dumps({
                "schema_version": 1, "sources": [], "documents": [], "entities": [], "claims": [],
            }), encoding="utf-8")
            interest = next(item for item in imported["claims"] if item["lineage_id"] == "lobbywatch:interests:30")
            badge = next(item for item in imported["claims"] if item["lineage_id"] == "lobbywatch:badge:60")

            review_claims(imported_path, authored_path, [interest["id"]], "VERIFIED", "reviewer-1",
                          "2026-09-12T12:00:00+00:00")
            review_claims(imported_path, authored_path, [badge["id"]], "REJECTED", "reviewer-1",
                          "2026-09-12T12:01:00+00:00")

            authored = read_dataset(authored_path)
            decisions = {item["id"]: item for item in authored["claims"]}
            self.assertEqual(decisions[interest["id"]]["status"], "VERIFIED")
            self.assertEqual(decisions[badge["id"]]["status"], "REJECTED")
            from pipeline.build import merge_research, project
            self.assertEqual([item["id"] for item in project(merge_research(authored, [imported]))["edges"]],
                             [interest["id"]])
            with self.assertRaisesRegex(ValueError, "authored decision"):
                review_claims(imported_path, authored_path, [interest["id"]], "VERIFIED", "reviewer-2")

    def test_invalid_archive_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("unexpected.json", "[]")
            with self.assertRaisesRegex(ValueError, DATA_MEMBER):
                validate_archive(path)

    def test_official_exact_interest_match_is_published_without_lobbywatch_dates(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "raw"
            archive.mkdir()
            imported_path = Path(directory) / "candidate.json"
            verified_path = Path(directory) / "verified/research.json"
            (archive / EXPORT_FILENAME).write_bytes(export_bytes(self.fixture()))
            materialize(archive, imported_path)
            report = corroborate(imported_path, verified_path, {4051: {
                "id": 4051,
                "updated": "2026-09-12T12:00:00Z",
                "firstName": "Thomas",
                "lastName": "Beispiel",
                "concerns": [{
                    "name": "Beispiel AG",
                    "organizationType": "VR",
                    "function": "P",
                    "agency": "F",
                    "type": "AG",
                }],
            }})
            verified = read_dataset(verified_path)

            self.assertEqual(report["verified_exact_matches"], 1)
            self.assertEqual(len(verified["claims"]), 1)
            claim = verified["claims"][0]
            self.assertEqual(claim["status"], "VERIFIED")
            self.assertEqual(claim["reviewed_by"], "automatic:ch-parliament-official-api")
            self.assertIsNone(claim["valid_from"])
            self.assertEqual(claim["corroborates_claim_id"].split(":")[2], "interests")
            from pipeline.build import project
            self.assertEqual(len(project(verified)["edges"]), 1)

    def test_official_mismatch_and_ambiguous_candidates_stay_private(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "raw"
            archive.mkdir()
            imported_path = Path(directory) / "candidate.json"
            verified_path = Path(directory) / "verified/research.json"
            fixture = self.fixture()
            duplicate = json.loads(json.dumps(fixture[0]["interessenbindungen"][0]))
            duplicate["id"] = 31
            fixture[0]["interessenbindungen"].append(duplicate)
            (archive / EXPORT_FILENAME).write_bytes(export_bytes(fixture))
            materialize(archive, imported_path)
            report = corroborate(imported_path, verified_path, {4051: {
                "id": 4051,
                "updated": "2026-09-12T12:00:00Z",
                "concerns": [
                    {"name": "Beispiel AG", "organizationType": "VR", "function": "P"},
                    {"name": "Unbekannt AG", "organizationType": "VR", "function": "M"},
                ],
            }})

            self.assertEqual(report["verified_exact_matches"], 0)
            self.assertEqual(report["ambiguous_matches"], 1)
            self.assertEqual(report["unmatched_official_concerns"], 1)
            self.assertEqual(read_dataset(verified_path)["claims"], [])

    def test_official_role_and_name_normalization_is_conservative(self):
        self.assertEqual(canonical_name("  Société & Partner  "), "societe und partner")
        self.assertEqual(concern_predicate({"function": "VP", "organizationType": "VR"}),
                         "VICE_PRESIDENT_OF")
        self.assertEqual(concern_predicate({"function": "M", "organizationType": "Bei."}),
                         "HAS_MANDATE_AT")
        self.assertIsNone(concern_predicate({"function": "Sek.", "organizationType": "V"}))

    def test_duplicate_official_rows_are_not_automatically_published(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "raw"
            archive.mkdir()
            imported_path = Path(directory) / "candidate.json"
            verified_path = Path(directory) / "verified/research.json"
            (archive / EXPORT_FILENAME).write_bytes(export_bytes(self.fixture()))
            materialize(archive, imported_path)
            concern = {"name": "Beispiel AG", "organizationType": "VR", "function": "P"}
            report = corroborate(imported_path, verified_path, {4051: {
                "id": 4051, "updated": "2026-09-12T12:00:00Z",
                "concerns": [concern, dict(concern)],
            }})

            self.assertEqual(report["verified_exact_matches"], 0)
            self.assertEqual(report["ambiguous_matches"], 2)
            self.assertEqual(read_dataset(verified_path)["claims"], [])


if __name__ == "__main__":
    unittest.main()
