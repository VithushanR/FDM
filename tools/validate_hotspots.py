"""Checks a hotspot file against its contract and prints every problem.

Usage (from the repo root):
    python tools/validate_hotspots.py results/spatial_temporal/hotspots.json

Version 1 files are checked as before. Version 2 files are checked against every rule in the contract, and the
profile file next to them (hotspot_profiles.json.gz) is checked too, when it is there.
Exit code 0 means no problems were found. Exit code 1 means there were problems, or the file could not be read.
"""

import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.schemas.hotspots import (  # noqa: E402
    HotspotFileError, load_hotspot_raw, parse_hotspot_data, validate_profiles, validate_v2,
)
from backend.services.hotspot_service import PROFILES_NAME  # noqa: E402


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except FileNotFoundError:
        return None, f"File not found: {path}"
    except json.JSONDecodeError as exc:
        return None, f"Not valid JSON: {exc}"


def read_profiles(path: Path):
    try:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle), None
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        return None, f"Profile file {path.name} could not be read: {exc}"


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python tools/validate_hotspots.py <path to hotspots.json>")
        sys.exit(1)
    path = Path(sys.argv[1])
    raw, problem = read_json(path)
    if problem:
        print(problem)
        sys.exit(1)

    try:
        version = load_hotspot_raw(raw)
    except HotspotFileError as exc:
        for item in exc.problems:
            print(f"- {item}")
        print("1 problem(s) found.")
        sys.exit(1)

    problems: list[str] = []
    if version == 1:
        try:
            parse_hotspot_data(raw)
        except HotspotFileError as exc:
            problems = exc.problems
    else:
        problems = validate_v2(raw)
        profiles_path = path.with_name(PROFILES_NAME)
        if not profiles_path.exists():
            print(f"Note: no profile file next to this one ({PROFILES_NAME}). Details and busiest_time are unavailable.")
        elif not problems:
            profiles, read_problem = read_profiles(profiles_path)
            problems = [read_problem] if read_problem else validate_profiles(profiles, raw["hotspots"])

    for item in problems:
        print(f"- {item}")
    if problems:
        print(f"{len(problems)} problem(s) found in {path}.")
        sys.exit(1)
    count = len(raw.get("hotspots", []))
    method = raw.get("method", "")
    print(f"OK: {path} is valid (version {version}). {count} hotspots, method {method!r}.")
    if method.upper().startswith("SAMPLE"):
        print("Warning: this is a SAMPLE file, not real results.")


if __name__ == "__main__":
    main()
