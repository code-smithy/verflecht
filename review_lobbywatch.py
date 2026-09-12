"""Record human Lobbywatch claim decisions in authored research."""

import argparse
import json
from pathlib import Path

from pipeline.build import ROOT
from pipeline.lobbywatch_review import DECISIONS, review_claims


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("claim_ids", nargs="+")
    parser.add_argument("--decision", required=True, choices=DECISIONS)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--imported", type=Path, default=ROOT / "data/imports/lobbywatch/research.json")
    parser.add_argument("--authored", type=Path, default=ROOT / "data/research.json")
    args = parser.parse_args()
    print(json.dumps(review_claims(args.imported, args.authored, args.claim_ids,
                                  args.decision, args.reviewer), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
