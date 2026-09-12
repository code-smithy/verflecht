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

    def test_invalid_archive_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("unexpected.json", "[]")
            with self.assertRaisesRegex(ValueError, DATA_MEMBER):
                validate_archive(path)


if __name__ == "__main__":
    unittest.main()
