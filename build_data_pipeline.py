"""Build browser-ready JSON from local research; no services or API keys needed."""

import argparse
import json
import sys
from pathlib import Path

from pipeline.build import ROOT, ValidationError, build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "data/research.json")
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/graph.json")
    parser.add_argument("--check", action="store_true", help="Validate and fail if the export is missing or stale; write nothing")
    parser.add_argument("--imports-dir", type=Path, default=ROOT / "data/imports", help="Local generated imports used with the default authoring file")
    args = parser.parse_args()
    try:
        imports = sorted(args.imports_dir.glob("*/research.json")) if args.input.resolve() == (ROOT / "data/research.json").resolve() else []
        graph = build(args.input, args.output, check=args.check, import_paths=imports)
    except (ValidationError, OSError, UnicodeError, json.JSONDecodeError) as error:
        print(f"Pipeline failed: {error}", file=sys.stderr)
        return 1
    print(f"{'Checked' if args.check else 'Built'} {len(graph['nodes'])} entities and {len(graph['edges'])} verified relationships: {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
