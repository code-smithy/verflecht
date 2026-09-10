"""Archive all available Swiss Parliament API records, in all four languages."""

import argparse
import json
from pathlib import Path

from pipeline.build import ROOT
from pipeline.parliament import LANGUAGES, import_archive
from pipeline.parliament_normalize import materialize


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=ROOT / "data/raw/parliament")
    parser.add_argument("--languages", nargs="+", choices=LANGUAGES, default=list(LANGUAGES))
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--interval", type=float, default=0.2, help="Minimum seconds between requests across all workers")
    parser.add_argument("--max-requests", type=int, help="Pause after this many network attempts; default is unlimited")
    parser.add_argument("--max-seconds", type=int, help="Pause at this runtime limit, leaving time to save runner artifacts")
    parser.add_argument("--refresh", action="store_true", help="Start a fresh listing cycle after a completed import; reuse unchanged details")
    parser.add_argument("--normalize-only", action="store_true", help="Build research candidates from cached records without network access")
    parser.add_argument("--output", type=Path, default=ROOT / "data/imports/parliament/research.json")
    parser.add_argument("--status", action="store_true", help="Print the saved progress report without downloading")
    args = parser.parse_args()
    if args.status:
        print((args.archive / "manifest.json").read_text(encoding="utf-8"))
        return 0
    if args.normalize_only:
        print(json.dumps(materialize(args.archive, args.output), ensure_ascii=False))
        return 0
    state = import_archive(args.archive, args.languages, args.workers, args.interval, args.max_requests,
                           max_seconds=args.max_seconds, refresh=args.refresh)
    report = materialize(args.archive, args.output)
    print(json.dumps(report, ensure_ascii=False))
    print(json.dumps({key: state[key] for key in ("status", "downloaded_requests", "cached_requests", "errors")}, ensure_ascii=False))
    return 0 if state["status"] in ("complete", "paused") else 1


if __name__ == "__main__":
    raise SystemExit(main())
