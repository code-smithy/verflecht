"""Shared language-job configuration and Parliament snapshot publication."""

import copy
import json
import os
from pathlib import Path
import sys

from pipeline.build import project, require
from pipeline.json_store import read_dataset, write_dataset
from pipeline.parliament import LANGUAGES, atomic_json


def configuration(language, seconds):
    require(language == "all" or language in LANGUAGES, "unsupported language")
    budget = int(seconds)
    require(60 <= budget <= 14400, "time budget must be 60–14400 seconds")
    return list(LANGUAGES) if language == "all" else [language], budget


def combine(results, destination):
    results, destination = Path(results), Path(destination)
    snapshots, reports = {}, {}
    legacy_path = destination / "research.json"
    legacy = read_dataset(legacy_path) if legacy_path.exists() else None
    # Seed old published data once. A partial-language run must not erase it.
    if legacy:
        project(legacy)
        for language in LANGUAGES:
            seed = copy.deepcopy(legacy)
            if language != "de":
                seed["claims"], seed["documents"] = [], []
            for entity in seed["entities"]:
                names = entity.get("names", {})
                entity["names"] = {language: names[language]} if language in names else {}
            snapshots[language] = seed
    for language in LANGUAGES:
        for root in (destination / "languages", results):
            path = root / language / "research.json"
            if path.exists():
                dataset = read_dataset(path)
                project(dataset)
                require(language == "de" or not dataset["claims"], "non-German snapshot cannot publish claims")
                snapshots[language] = dataset
                report_path = path.with_name("normalization-report.json")
                if report_path.exists():
                    reports[language] = json.loads(report_path.read_text())
    require(any((results / lang / "research.json").exists() for lang in LANGUAGES), "no language results")
    combined = {"schema_version": 1, "sources": [], "documents": [], "entities": [], "claims": []}
    # German supplies claims/evidence and preferred names. Other jobs add names.
    for key in ("sources", "documents", "claims"):
        rows = {}
        for language in reversed(LANGUAGES):
            for row in snapshots.get(language, {}).get(key, []):
                rows[row["id"]] = row
        combined[key] = [rows[key] for key in sorted(rows)]
    entities = {}
    for language in reversed(LANGUAGES):
        for row in snapshots.get(language, {}).get("entities", []):
            previous = entities.get(row["id"], {})
            names = {**previous.get("names", {}), **row.get("names", {})}
            entities[row["id"]] = {**row, "names": names}
    combined["entities"] = [entities[key] for key in sorted(entities)]
    project(combined)
    for language, dataset in snapshots.items():
        path = destination / "languages" / language
        write_dataset(path / "research.json", dataset)
        if language in reports:
            atomic_json(path / "normalization-report.json", reports[language])
    write_dataset(destination / "research.json", combined)
    atomic_json(destination / "normalization-report.json", {
        "languages": sorted(snapshots), "language_reports": reports,
        "entities": len(combined["entities"]), "verified_claims": len(combined["claims"]),
        "note": "Language snapshots may have different retrieval dates. German supplies claim evidence.",
    })
    return combined


def main():
    command = sys.argv[1]
    if command == "config":
        languages, budget = configuration(os.environ["IMPORT_LANGUAGE"], os.environ["IMPORT_MAX_SECONDS"])
        print("languages=" + json.dumps(languages))
        print(f"max_seconds={budget}")
    elif command == "combine":
        combine(sys.argv[2], sys.argv[3])
    elif command == "summary":
        report = json.loads(Path(sys.argv[2]).read_text())
        print(f"## Import {', '.join(report['languages'])}: {report['status']}\n")
        print("Paused imports resume from their own checkpoint on the next run.\n")
        print("| Collection | Records | Complete |\n| --- | ---: | --- |")
        for name, item in report["collections"].items():
            print(f"| {name} | {item['records']} | {item['complete']} |")
        print("\n| Details | Imported | Discovered |\n| --- | ---: | ---: |")
        for name, item in report["details"].items():
            print(f"| {name} | {item['completed']} | {item['total']} |")
        for error in report["errors"]:
            print(f"\n- {error}")
    else:
        raise ValueError("unknown command")


if __name__ == "__main__":
    main()
