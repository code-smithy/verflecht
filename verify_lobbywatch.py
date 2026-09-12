"""Verify exact Lobbywatch interest matches against official Parliament records."""

import argparse
import json
from pathlib import Path

from pipeline.build import ROOT
from pipeline.json_store import read_dataset
from pipeline.lobbywatch_verify import corroborate, fetch_official_concerns


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "data/imports/lobbywatch/research.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/imports/lobbywatch-verified/research.json")
    parser.add_argument("--archive", type=Path, default=ROOT / "data/raw/lobbywatch/parliament")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--interval", type=float, default=0.2)
    args = parser.parse_args()

    imported = read_dataset(args.input)
    person_ids = {
        int(entity["id"].rsplit(":", 1)[-1])
        for entity in imported.get("entities", [])
        if entity.get("type") == "PERSON" and str(entity.get("id", "")).startswith("parliament:person:")
    }
    records = fetch_official_concerns(
        person_ids, args.archive, workers=args.workers, interval=args.interval,
    )
    report = corroborate(args.input, args.output, records)
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
