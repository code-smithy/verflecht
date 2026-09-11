import json
import tempfile
import unittest
from pathlib import Path

from pipeline.build import ROOT, build, project
from pipeline.json_store import ValidationError, read_dataset, write_dataset


class JsonStoreTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((ROOT / "tests/fixtures/research.json").read_text(encoding="utf-8"))
        self.data["entities"].extend({"id": f"extra-{i}", "name": "ü" * 80, "type": "PERSON"} for i in range(30))

    def test_parts_round_trip_build_and_deterministic_check(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "research.json"
            write_dataset(source, self.data, max_bytes=2048)
            self.assertEqual(json.loads(source.read_text())["storage"], "json-parts-v1")
            self.assertEqual(read_dataset(source), self.data)
            self.assertEqual(build(source, Path(directory) / "graph.json"), project(self.data))
            before = {p.name: p.read_bytes() for p in Path(directory).rglob("*.json")}
            write_dataset(source, self.data, max_bytes=2048, check=True)
            write_dataset(source, self.data, max_bytes=2048)
            self.assertEqual(before, {p.name: p.read_bytes() for p in Path(directory).rglob("*.json")})
            self.assertTrue(all(p.stat().st_size <= 2048 for p in source.with_suffix(".parts").glob("*.json")))

    def test_utf8_byte_boundaries_and_shrink_cleanup(self):
        data = {"schema_version": 1, "nodes": [{"id": str(i), "name": "ü" * 80} for i in range(100)], "edges": []}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "graph.json"
            write_dataset(path, data, max_bytes=4096)
            self.assertEqual(read_dataset(path), data)
            self.assertGreater(len(list(path.with_suffix(".parts").glob("*.json"))), 1)
            self.assertTrue(all(p.stat().st_size <= 4096 for p in Path(directory).rglob("*.json")))
            write_dataset(path, {"schema_version": 1, "nodes": [], "edges": []}, max_bytes=4096)
            self.assertEqual(list(path.with_suffix(".parts").glob("*.json")), [])

    def test_missing_corrupt_and_stale_parts_fail_without_check_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "research.json"
            write_dataset(path, self.data, max_bytes=2048)
            part = next(path.with_suffix(".parts").glob("*.json"))
            part.write_text("[]\n")
            with self.assertRaisesRegex(ValidationError, "corrupt"):
                read_dataset(path)
            with self.assertRaisesRegex(ValidationError, "stale"):
                write_dataset(path, self.data, max_bytes=2048, check=True)
            self.assertEqual(part.read_text(), "[]\n")
            part.unlink()
            with self.assertRaises(OSError):
                read_dataset(path)
            with self.assertRaisesRegex(ValidationError, "stale"):
                write_dataset(path, self.data, max_bytes=2048, check=True)
            self.assertFalse(part.exists())

    def test_oversized_record_preserves_previous_export(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "research.json"
            write_dataset(path, self.data)
            previous = path.read_bytes()
            self.data["documents"][0]["text"] = "x" * 4096
            with self.assertRaisesRegex(ValidationError, "one record exceeds"):
                write_dataset(path, self.data, max_bytes=2048)
            self.assertEqual(previous, path.read_bytes())

    def test_parts_cannot_escape_dataset_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "research.json"
            path.write_text(json.dumps({"schema_version": 1, "storage": "json-parts-v1", "parts": {"claims": ["../private.json"]}}))
            with self.assertRaisesRegex(ValidationError, "invalid dataset part path"):
                read_dataset(path)

    def test_sharded_imports_keep_authored_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            imported = Path(directory) / "import/research.json"
            authored = Path(directory) / "research.json"
            write_dataset(imported, self.data, max_bytes=2048)
            self.data["claims"][0]["status"] = "REJECTED"
            write_dataset(authored, self.data)
            self.assertEqual(build(authored, Path(directory) / "graph.json", import_paths=[imported])["edges"], [])
