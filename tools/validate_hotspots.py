"""Checks a hotspot file against the contract and prints every problem.

Usage (from the repo root):
    python tools/validate_hotspots.py results/spatial_temporal/hotspots.json

Exit code 0 means the file is valid. Exit code 1 means it is not, or it could not be read.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.schemas.hotspots import HotspotFileError, parse_hotspot_data  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python tools/validate_hotspots.py <path to hotspots.json>")
        sys.exit(1)
    path = Path(sys.argv[1])
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"File not found: {path}")
        sys.exit(1)
    except json.JSONDecodeError as exc:
        print(f"Not valid JSON: {exc}")
        sys.exit(1)

    try:
        parsed = parse_hotspot_data(raw)
    except HotspotFileError as exc:
        for problem in exc.problems:
            print(f"- {problem}")
        print(f"{len(exc.problems)} problem(s) found in {path}.")
        sys.exit(1)

    print(f"OK: {path} is valid. {len(parsed.hotspots)} hotspots, method {parsed.method!r}.")
    if parsed.method.upper().startswith("SAMPLE"):
        print("Warning: this is a SAMPLE file, not real results.")


if __name__ == "__main__":
    main()
