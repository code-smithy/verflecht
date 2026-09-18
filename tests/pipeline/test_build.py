import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from pipeline.build import ROOT, ValidationError, build, project


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((ROOT / "tests/fixtures/research.json").read_text(encoding="utf-8"))

    def test_empty_dataset(self):
        self.assertEqual(project({"schema_version": 1, "sources": [], "documents": [], "entities": [], "claims": []}), {"schema_version": 1, "nodes": [], "edges": []})

    def test_public_contract_and_private_field_exclusion(self):
        result = project(self.data)
        self.assertEqual(result, json.loads((ROOT / "tests/fixtures/graph.json").read_text(encoding="utf-8")))
        serialized = json.dumps(result)
        for private in ("internal", "reviewer", "reviewed_at", "Unpublished", "private-person", "status"):
            self.assertNotIn(private, serialized)

    def test_unverified_statuses_never_publish(self):
        for status in ("DETECTED", "PENDING_REVIEW", "REJECTED", "DISPUTED", "OUTDATED"):
            with self.subTest(status=status):
                self.data["claims"][0]["status"] = status
                self.assertEqual(project(self.data)["edges"], [])
                self.assertEqual(project(self.data)["nodes"], [])

    def test_invalid_records_fail(self):
        mutations = [
            ("sources", "type", "PDF"),
            ("sources", "url", "javascript:alert(1)"),
            ("sources", "url", "https://user:secret@example.org"),
            ("sources", "url", "https://bad host.example.org"),
            ("documents", "source_id", "missing"),
            ("documents", "text", "unrelated text"),
            ("entities", "type", "unknown"),
            ("claims", "subject_id", "missing"),
            ("claims", "predicate", "MADE_UP"),
            ("claims", "predicate", "PARTICIPATED_IN"),
            ("claims", "status", "unknown"),
            ("claims", "connection_class", "HISTORICAL"),
            ("claims", "evidence", []),
            ("claims", "evidence", [{"document_id": "missing", "text": "x"}]),
            ("claims", "reviewed_by", ""),
            ("claims", "reviewed_at", "2026-09-10"),
            ("claims", "valid_from", "2026-02-30"),
        ]
        for collection, key, value in mutations:
            with self.subTest(collection=collection, key=key, value=value):
                data = copy.deepcopy(self.data)
                data[collection][0][key] = value
                with self.assertRaises(ValidationError):
                    project(data)

    def test_duplicates_and_schema_errors(self):
        for data in ([], {}, {**self.data, "schema_version": True}, {**self.data, "sources": {}}, {**self.data, "claims": self.data["claims"] * 2}):
            with self.subTest(data=data), self.assertRaises(ValidationError):
                project(data)

    def test_historical_dates(self):
        claim = self.data["claims"][0]
        claim.update(connection_class="HISTORICAL", valid_from="2020-01-01", valid_to="2021-01-01")
        self.assertEqual(project(self.data)["edges"][0]["valid_to"], "2021-01-01")
        claim["valid_from"] = "2022-01-01"
        with self.assertRaises(ValidationError):
            project(self.data)

    def test_multiple_sources_and_event_claims(self):
        self.data["sources"].append({"id": "source-2", "name": "Example reporting", "type": "media", "url": "https://example.com"})
        self.data["documents"].append({"id": "document-2", "source_id": "source-2", "title": "Report", "url": "https://example.com/report", "text": "Example Person attended Example Event."})
        self.data["entities"].append({"id": "event-1", "name": "Example Event", "type": "EVENT"})
        self.data["claims"][0]["evidence"].append({"document_id": "document-2", "text": "Example Person"})
        self.data["claims"].append({**self.data["claims"][0], "id": "event-claim", "object_id": "event-1", "predicate": "PARTICIPATED_IN", "evidence": [{"document_id": "document-2", "text": "Example Person attended Example Event."}]})
        result = project(self.data)
        self.assertEqual(len(result["edges"]), 2)
        self.assertEqual(len(result["edges"][0]["evidence"]), 2)
        self.assertIn("event-1", [node["id"] for node in result["nodes"]])

    def test_supersession_requires_verified_replacement_and_preserves_input(self):
        replacement = {**self.data["claims"][0], "id": "claim-2", "supersedes_id": "claim-1", "status": "PENDING_REVIEW"}
        self.data["claims"].append(replacement)
        self.assertEqual([edge["id"] for edge in project(self.data)["edges"]], ["claim-1"])
        replacement["status"] = "VERIFIED"
        original = copy.deepcopy(self.data)
        self.assertEqual([edge["id"] for edge in project(self.data)["edges"]], ["claim-2"])
        self.assertEqual(self.data, original)
        self.data["claims"][0]["supersedes_id"] = "claim-2"
        with self.assertRaisesRegex(ValidationError, "cycle"):
            project(self.data)

    def test_multiple_verified_replacements_rejected(self):
        for identifier in ("claim-2", "claim-3"):
            self.data["claims"].append({**self.data["claims"][0], "id": identifier, "supersedes_id": "claim-1"})
        with self.assertRaisesRegex(ValidationError, "multiple verified replacements"):
            project(self.data)

    def test_build_is_deterministic_and_failure_preserves_export(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "research.json", Path(directory) / "graph.json"
            source.write_text(json.dumps(self.data), encoding="utf-8")
            build(source, output)
            first = output.read_bytes()
            self.data["entities"].reverse()
            source.write_text(json.dumps(self.data), encoding="utf-8")
            build(source, output)
            self.assertEqual(first, output.read_bytes())
            build(source, output, check=True)
            self.data["claims"][0]["evidence"] = []
            source.write_text(json.dumps(self.data), encoding="utf-8")
            with self.assertRaises(ValidationError):
                build(source, output)
            self.assertEqual(first, output.read_bytes())
            with self.assertRaisesRegex(ValidationError, "must differ"):
                build(source, source)

    def test_check_does_not_write_and_duplicate_json_keys_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "research.json", Path(directory) / "graph.json"
            source.write_text(json.dumps(self.data), encoding="utf-8")
            with self.assertRaisesRegex(ValidationError, "stale"):
                build(source, output, check=True)
            self.assertFalse(output.exists())
            source.write_text('{"schema_version":1,"schema_version":1}', encoding="utf-8")
            with self.assertRaisesRegex(ValidationError, "duplicate key"):
                build(source, output)

    def test_cli_from_another_directory_and_error_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "research.json", Path(directory) / "graph.json"
            source.write_text(json.dumps(self.data), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(ROOT / "build_data_pipeline.py"), "--input", str(source), "--output", str(output)],
                cwd=directory,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(output.is_file())
            result = subprocess.run([sys.executable, str(ROOT / "build_data_pipeline.py"), "--input", str(Path(directory) / "missing.json")], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("Pipeline failed", result.stderr)


if __name__ == "__main__":
    unittest.main()
