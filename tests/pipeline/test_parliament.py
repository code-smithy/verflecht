import copy
import gzip
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from pipeline.build import ValidationError, merge_research, project
from pipeline.parliament import (AccessDenied, BudgetReached, Client, ImportFailure,
                                Resource, encode, has_more, import_archive,
                                page_fingerprint, request_url, retry_seconds)
from pipeline.parliament_normalize import materialize


class ParliamentTests(unittest.TestCase):
    def client(self, directory, responses):
        client = Client(directory, interval=0)
        client.check_robots = Mock()
        client.download = Mock(side_effect=lambda url: encode(responses[url]).encode("utf-8"))
        return client

    def test_last_record_pagination_flag(self):
        self.assertTrue(has_more([{"id": 1}, {"id": 2, "hasMorePages": True}]))
        self.assertFalse(has_more([{"id": 1}]))
        self.assertFalse(has_more([]))
        for value in ({"items": []}, [None], [{"hasMorePages": "true"}]):
            with self.assertRaises(ValidationError):
                has_more(value)

    def test_request_urls_and_language_validation(self):
        self.assertEqual(request_url("votes/councillors/2565", "fr"), "https://ws-old.parlament.ch/votes/councillors/2565?format=json&lang=fr")
        self.assertIn("pageNumber=2", request_url("affairs", "de", 2))
        for arguments in (("../secret", "de"), ("affairs", "xx"), ("affairs", "de", 0)):
            with self.assertRaises(ValidationError):
                request_url(*arguments)

    def test_generated_timestamps_do_not_hide_repeated_pages(self):
        self.assertEqual(page_fingerprint([{"id": 1, "updated": "old", "hasMorePages": True}]), page_fingerprint([{"id": 1, "updated": "new"}]))

    def test_all_pages_languages_and_unique_details_are_imported(self):
        responses = {}
        for language in ("de", "fr", "it", "en"):
            responses[request_url("councillors", language, 1)] = [{"id": 1, "updated": "stable", "hasMorePages": True}]
            responses[request_url("councillors", language, 2)] = [{"id": 2}]
            responses[request_url("councillors/historic", language, 1)] = [{"id": 1, "updated": "generated", "membership": {"entryDate": "1900-01-01"}}, {"id": 1, "membership": {"entryDate": "1901-01-01"}}]
            for identifier in (1, 2):
                responses[request_url(f"councillors/{identifier}", language)] = {"id": identifier}
        with tempfile.TemporaryDirectory() as directory:
            client = self.client(directory, responses)
            resources = (Resource("councillors", "councillors"), Resource("councillors/historic", "councillors"))
            state = import_archive(directory, resources=resources, client=client)
            self.assertEqual(state["status"], "complete")
            self.assertEqual(client.download.call_count, 20)
            self.assertEqual(state["collections"]["de/councillors/historic"]["records"], 2)
            self.assertEqual(state["details"]["de/councillors"]["completed"], 2)
            resumed = self.client(directory, responses)
            self.assertEqual(import_archive(directory, resources=resources, client=resumed)["status"], "complete")
            resumed.download.assert_not_called()

    def test_refresh_downloads_changed_details_and_preserves_prior_versions(self):
        responses = {request_url("councillors", "de", 1): [{"id": 1, "updated": "v1"}], request_url("councillors/1", "de"): {"id": 1, "firstName": "Old"}}
        with tempfile.TemporaryDirectory() as directory:
            resources = (Resource("councillors", "councillors"),)
            import_archive(directory, ["de"], resources=resources, client=self.client(directory, responses))
            refreshed = self.client(directory, responses)
            import_archive(directory, ["de"], resources=resources, client=refreshed, refresh=True)
            self.assertEqual(refreshed.download.call_count, 1)
            responses[request_url("councillors", "de", 1)][0]["updated"] = "v2"
            responses[request_url("councillors/1", "de")]["firstName"] = "New"
            changed = self.client(directory, responses)
            import_archive(directory, ["de"], resources=resources, client=changed, refresh=True)
            self.assertEqual(changed.download.call_count, 2)
            self.assertTrue(list((Path(directory) / "versions").glob("*.gz")))

    def test_paused_run_resumes_cached_pages(self):
        responses = {request_url("councillors", "de", 1): [{"id": 1}], request_url("councillors/1", "de"): {"id": 1}}
        with tempfile.TemporaryDirectory() as directory:
            client = self.client(directory, responses)
            client.download.side_effect = [encode([{"id": 1}]).encode(), BudgetReached("test limit")]
            resources = (Resource("councillors", "councillors"),)
            state = import_archive(directory, ["de"], workers=1, resources=resources, client=client)
            self.assertEqual(state["status"], "paused")
            resumed = self.client(directory, responses)
            state = import_archive(directory, ["de"], resources=resources, client=resumed, refresh=True)
            self.assertEqual(state["status"], "complete")
            self.assertEqual(resumed.download.call_count, 1)

    def test_repeated_pages_and_failed_details_are_not_reported_complete(self):
        responses = {request_url("councillors", "de", 1): [{"id": 1, "hasMorePages": True}], request_url("councillors", "de", 2): [{"id": 1, "hasMorePages": True}], request_url("councillors/1", "de"): {"id": 999}}
        with tempfile.TemporaryDirectory() as directory:
            client = self.client(directory, responses)
            state = import_archive(directory, ["de"], resources=(Resource("councillors", "councillors"),), client=client)
            self.assertEqual(state["status"], "incomplete")
            self.assertEqual(len(state["errors"]), 2)
            self.assertFalse(client.cache_path(request_url("councillors/1", "de")).exists())

    def test_html_errors_and_corrupted_cache_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            client = self.client(directory, {})
            client.download.return_value = b"<html>Error</html>"
            client.download.side_effect = None
            with self.assertRaises(ValueError):
                client.fetch("councillors", "de", 1)
            path = client.cache_path(request_url("councillors", "de", 1))
            self.assertFalse(path.exists())
            path.parent.mkdir(parents=True)
            path.write_bytes(b"broken archive")
            with self.assertRaisesRegex(ImportFailure, "corrupt cache"):
                client.fetch("councillors", "de", 1)

    def test_access_denied_stops_without_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            client = Client(directory, interval=0)
            with patch("pipeline.parliament.urlopen", side_effect=HTTPError("https://ws-old.parlament.ch/", 403, "Forbidden", {}, None)) as request:
                with self.assertRaises(AccessDenied):
                    client.download("https://ws-old.parlament.ch/")
                self.assertEqual(request.call_count, 1)
                self.assertTrue(client.stop.is_set())

    def test_runtime_budget_and_retry_after(self):
        self.assertEqual(retry_seconds("30", 2), 30)
        self.assertEqual(retry_seconds("invalid", 2), 2)
        with tempfile.TemporaryDirectory() as directory:
            client = Client(directory)
            client.deadline = time.monotonic() - 1
            with self.assertRaises(BudgetReached):
                client.fetch("councillors", "de", 1)

    def test_affair_authors_are_explicit_deduplicated_and_source_backed(self):
        person = {"type": "author", "councillor": {"id": 1, "name": "Person Example"},
                  "faction": {"id": 2, "name": "Context, not a coauthor"}}
        committee = {"type": "author", "committee": {"id": 25, "name": "Committee"}}
        faction = {"type": "author", "faction": {"id": 3, "name": "Author Faction"}}
        responses = {}
        for language in ("de", "fr"):
            responses[request_url("affairs", language, 1)] = [{"id": 20243200, "updated": "first"}]
            responses[request_url("affairs/20243200", language)] = {
                "id": 20243200, "title": "Example affair" if language == "de" else "French title",
                "author": person, "roles": [person, committee, faction,
                    {"type": "cosign", "councillor": {"id": 4, "name": "Explicit Co-signatory"}},
                    {"type": "correspondent", "councillor": {"id": 99, "name": "Not an author"}},
                    {"type": "author", "councillor": {"name": "Missing ID"}},
                    {"type": "author", "councillor": {"id": True, "name": "Bad ID"}},
                    {"type": "author", "councillor": person["councillor"], "committee": committee["committee"]}],
                "texts": [{"value": "Mentioned Person must not become an author"}],
            }
        with tempfile.TemporaryDirectory() as directory:
            resources = (Resource("affairs", "affairs"),)
            import_archive(directory, ["de", "fr"], resources=resources, client=self.client(directory, responses))
            output = Path(directory) / "normalized/research.json"
            report = materialize(directory, output)
            dataset = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(report["authorship_claims"], 3)
            self.assertEqual(report["cosignatory_claims"], 1)
            self.assertEqual(report["affair_detail_responses"], 2)
            self.assertEqual(len(report["skipped_affairs"]), 3)
            self.assertEqual(len(project(dataset)["edges"]), 4)
            self.assertEqual({c["subject_id"] for c in dataset["claims"]},
                             {"parliament:person:1", "parliament:person:4", "parliament:committee:25", "parliament:organisation:factions:3"})
            affair = next(e for e in dataset["entities"] if e["type"] == "PARLIAMENTARY_AFFAIR")
            self.assertEqual(affair["names"], {"de": "Example affair", "fr": "French title"})
            for claim in dataset["claims"]:
                self.assertEqual(claim["predicate"], "CO_SIGNED" if claim["subject_id"] == "parliament:person:4" else "AUTHORED")
                self.assertEqual(claim["status"], "VERIFIED")
                self.assertIsNone(claim["valid_from"])
                self.assertIn(claim["evidence"][0]["text"], dataset["documents"][0]["text"])
            original = output.read_bytes()
            materialize(directory, output)
            self.assertEqual(output.read_bytes(), original)
            for language in ("de", "fr"):
                responses[request_url("affairs", language, 1)][0]["updated"] = "second"
                responses[request_url("affairs/20243200", language)]["author"] = None
                responses[request_url("affairs/20243200", language)]["roles"] = []
            import_archive(directory, ["de", "fr"], resources=resources, client=self.client(directory, responses), refresh=True)
            materialize(directory, output)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["claims"], [])

    def test_legacy_multilingual_cache_can_resume_one_language(self):
        responses = {}
        for language in ("de", "fr"):
            responses[request_url("councillors", language, 1)] = [{"id": 1, "updated": "same"}]
            responses[request_url("councillors/1", language)] = {"id": 1}
        with tempfile.TemporaryDirectory() as directory:
            resources = (Resource("councillors", "councillors"),)
            import_archive(directory, ["de", "fr"], resources=resources, client=self.client(directory, responses))
            resumed = self.client(directory, {})
            state = import_archive(directory, ["de"], resources=resources, client=resumed)
            self.assertEqual(state["languages"], ["de"])
            self.assertEqual(set(state["collections"]), {"de/councillors"})
            self.assertEqual(state["status"], "complete")
            resumed.download.assert_not_called()

    def test_active_party_and_faction_affiliations(self):
        person = {"id": 1, "firstName": "Example", "lastName": "Person", "active": True,
                  "partyId": 12, "partyName": "Example Party",
                  "factionId": 2, "factionName": "Example Faction"}
        for changes, expected in (({}, 2), ({"active": False}, 0),
                                  ({"active": None}, 0), ({"partyId": None}, 1),
                                  ({"partyId": True}, 1), ({"partyId": 0}, 1),
                                  ({"factionName": ""}, 1)):
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as directory:
                responses = {}
                for language in ("de", "fr"):
                    responses[request_url("councillors", language, 1)] = [{"id": 1}]
                    responses[request_url("councillors/1", language)] = {**person, **changes}
                import_archive(directory, ["de", "fr"], resources=(Resource("councillors", "councillors"),), client=self.client(directory, responses))
                output = Path(directory) / "normalized/research.json"
                report = materialize(directory, output)
                dataset = json.loads(output.read_text(encoding="utf-8"))
                self.assertEqual(report["verified_claims"], expected)
                self.assertEqual(len(project(dataset)["edges"]), expected)
                for claim in dataset["claims"]:
                    self.assertEqual(claim["predicate"], "MEMBER_OF")
                    self.assertIsNone(claim["valid_from"])
                    self.assertIsNone(claim["valid_to"])
                    self.assertEqual(claim["connection_class"], "OFFICIAL")
                    self.assertIn(claim["object_id"], ("parliament:political_party:12", "parliament:organisation:factions:2"))
                original = output.read_bytes()
                materialize(directory, output)
                self.assertEqual(original, output.read_bytes())

    def test_affiliation_refresh_removes_old_links_and_reuses_catalog_ids(self):
        resources = (Resource("councillors", "councillors"), Resource("parties/historic"), Resource("factions"))
        responses = {
            request_url("councillors", "de", 1): [{"id": 1, "updated": "first"}],
            request_url("councillors/1", "de"): {
                "id": 1, "active": True, "partyId": 12, "partyName": "Party",
                "factionId": 2, "factionName": "Faction"},
            request_url("parties/historic", "de", 1): [{"id": 12, "name": "Party"}],
            request_url("factions", "de", 1): [{"id": 2, "name": "Faction"}],
        }
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "normalized/research.json"
            import_archive(directory, ["de"], resources=resources, client=self.client(directory, responses))
            materialize(directory, output)
            first = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(len(first["entities"]), 3)
            self.assertEqual(len(first["claims"]), 2)
            for claim in first["claims"]:
                document = next(doc for doc in first["documents"] if doc["id"] == claim["evidence"][0]["document_id"])
                self.assertIn(claim["evidence"][0]["text"], document["text"])
            responses[request_url("councillors", "de", 1)][0]["updated"] = "second"
            responses[request_url("councillors/1", "de")]["active"] = False
            import_archive(directory, ["de"], resources=resources, client=self.client(directory, responses), refresh=True)
            materialize(directory, output)
            current = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(current["claims"], [])
            self.assertEqual(project(current)["edges"], [])

    def test_normalization_publishes_explicit_official_facts_and_authored_overrides(self):
        person = {"id": 1, "firstName": "Example", "lastName": "Person", "concerns": [{"name": "Not an inferred affiliation"}],
                  "councilMemberships": [{"id": 0, "entryDate": "2000-01-01T00:00:00Z", "leavingDate": "2004-01-01T00:00:00Z", "council": {"id": 1, "name": "Nationalrat"}}]}
        responses = {request_url("councillors", "de", 1): [{"id": 1}], request_url("councillors/1", "de"): person}
        with tempfile.TemporaryDirectory() as directory:
            import_archive(directory, ["de"], resources=(Resource("councillors", "councillors"),), client=self.client(directory, responses))
            output = Path(directory) / "normalized/research.json"
            report = materialize(directory, output)
            dataset = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(report["verified_claims"], 1)
            self.assertEqual(dataset["claims"][0]["connection_class"], "HISTORICAL")
            self.assertEqual(dataset["claims"][0]["status"], "VERIFIED")
            self.assertEqual(dataset["claims"][0]["reviewed_by"], "automatic:ch-parliament-official-api")
            self.assertEqual(len(project(dataset)["edges"]), 1)
            self.assertNotIn("Not an inferred affiliation", encode(dataset))
            original = output.read_bytes()
            materialize(directory, output)
            self.assertEqual(original, output.read_bytes())
            authored = {"schema_version": 1, "sources": [], "documents": [], "entities": [], "claims": [{**dataset["claims"][0], "status": "REJECTED"}]}
            self.assertEqual(merge_research(authored, [dataset])["claims"][0]["status"], "REJECTED")
            self.assertEqual(dataset["claims"][0]["status"], "VERIFIED")


if __name__ == "__main__":
    unittest.main()
