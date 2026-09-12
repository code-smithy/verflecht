"""Download Lobbywatch's weekly export and create review candidates."""

import argparse
import json
from pathlib import Path

from pipeline.build import ROOT
from pipeline.lobbywatch import EXPORT_URL, download_export, materialize


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=ROOT / "data/raw/lobbywatch")
    parser.add_argument("--output", type=Path, default=ROOT / "data/imports/lobbywatch/research.json")
    parser.add_argument("--url", default=EXPORT_URL)
    parser.add_argument("--normalize-only", action="store_true")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()
    if args.status:
        print((args.archive / "manifest.json").read_text(encoding="utf-8"))
        return 0
    if not args.normalize_only:
        print(json.dumps(download_export(args.archive, args.url), ensure_ascii=False))
    print(json.dumps(materialize(args.archive, args.output), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
