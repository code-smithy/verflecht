import copy
import json
from pathlib import Path
import tempfile
import unittest

from pipeline.build import ValidationError, project
from pipeline.json_store import read_dataset, write_dataset
from pipeline.language_import import combine, configuration
from pipeline.parliament import atomic_json


class LanguageImportTests(unittest.TestCase):
    def test_selection_and_budgets(self):
        self.assertEqual(configuration("de", "900"), (["de"], 900))
        self.assertEqual(configuration("all", "14400"), (["de", "fr", "it", "en"], 14400))
        for language, budget in (("xx", "900"), ("de", "0"), ("de", "14401"), ("de", "invalid")):
            with self.assertRaises(ValueError):
                configuration(language, budget)

    def test_single_language_updates_preserve_other_languages_and_claims(self):
        fixture = json.loads((Path(__file__).parents[1] / "fixtures/research.json").read_text())
        for row in fixture["entities"]:
            row["names"] = {"de": row["name"], "fr": "Ancien " + row["name"]}
        with tempfile.TemporaryDirectory() as directory:
            destination, results = Path(directory) / "published", Path(directory) / "results"
            atomic_json(destination / "research.json", fixture)
            french = copy.deepcopy(fixture)
            french["claims"], french["documents"] = [], []
            for row in french["entities"]:
                row["name"] = "Nouveau " + row["name"]
                row["names"] = {"fr": row["name"]}
            atomic_json(results / "fr/research.json", french)
            combined = combine(results, destination)
            self.assertEqual(combined["claims"], fixture["claims"])
            self.assertEqual(len(project(combined)["edges"]), 1)
            for row in combined["entities"]:
                self.assertTrue(row["names"]["fr"].startswith("Nouveau"))
                self.assertEqual(row["name"], row["names"]["de"])
            first = (destination / "research.json").read_bytes()
            combine(results, destination)
            self.assertEqual(first, (destination / "research.json").read_bytes())
            # A later German-only run replaces German claims, not French names.
            german = copy.deepcopy(fixture)
            german["claims"], german["documents"] = [], []
            for row in german["entities"]:
                row["names"] = {"de": row["name"]}
            german_results = Path(directory) / "german-results"
            atomic_json(german_results / "de/research.json", german)
            combined = combine(german_results, destination)
            self.assertEqual(combined["claims"], [])
            self.assertTrue(all(row["names"]["fr"].startswith("Nouveau") for row in combined["entities"]))

    def test_invalid_snapshot_does_not_replace_published_data(self):
        fixture = json.loads((Path(__file__).parents[1] / "fixtures/research.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            destination, results = Path(directory) / "published", Path(directory) / "results"
            atomic_json(destination / "research.json", fixture)
            previous = (destination / "research.json").read_bytes()
            atomic_json(results / "fr/research.json", fixture)
            with self.assertRaises(ValidationError):
                combine(results, destination)
            self.assertEqual(previous, (destination / "research.json").read_bytes())

    def test_sharded_language_results_are_combined(self):
        fixture = json.loads((Path(__file__).parents[1] / "fixtures/research.json").read_text())
        with tempfile.TemporaryDirectory() as directory:
            destination, results = Path(directory) / "published", Path(directory) / "results"
            source = results / "de/research.json"
            write_dataset(source, fixture, max_bytes=600)
            self.assertEqual(json.loads(source.read_text())["storage"], "json-parts-v1")

            combined = combine(results, destination)

            self.assertEqual(project(combined), project(fixture))
            self.assertEqual(read_dataset(destination / "research.json"), combined)
            self.assertEqual(read_dataset(destination / "languages/de/research.json"), fixture)


if __name__ == "__main__":
    unittest.main()
