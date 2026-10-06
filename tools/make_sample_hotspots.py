"""Writes a clearly labelled SAMPLE hotspot file, for tests and for trying the API before real results exist.

Usage (from the repo root):
    python tools/make_sample_hotspots.py tests/data/sample_hotspots.json

It refuses to write to the real hotspot path unless --force is given.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from backend.config import DEFAULT_HOTSPOT_PATH, resolve_hotspot_path  # noqa: E402

SUBSETS = ["all", "severe"]
SLICES = ["All times", "Night", "Morning Rush", "Midday", "Evening Rush", "Evening"]
SAMPLE_METHOD = "SAMPLE - not real results"


def build_sample(seed: int = 7, per_group: int = 4) -> dict:
    rng = np.random.default_rng(seed)
    hotspots = []
    next_id = 1
    for subset in SUBSETS:
        for slice_name in SLICES:
            for _ in range(per_group):
                fatal = int(rng.integers(0, 6))
                serious = int(rng.integers(1, 30))
                # "severe" means Fatal and Serious only, so it has no Slight collisions.
                slight = 0 if subset == "severe" else int(rng.integers(0, 40))
                hotspots.append({
                    "id": next_id,
                    "subset": subset,
                    "slice": slice_name,
                    "latitude": round(float(rng.uniform(51.0, 53.0)), 5),
                    "longitude": round(float(rng.uniform(-1.0, 0.5)), 5),
                    "radius_m": int(rng.integers(100, 400)),
                    "collisions": fatal + serious + slight,
                    "fatal": fatal,
                    "serious": serious,
                    "slight": slight,
                    "label": "SAMPLE",
                })
                next_id += 1
    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": SAMPLE_METHOD,
        "parameters": {"eps_m": 200, "min_samples": 10, "sample": True},
        "subsets": SUBSETS,
        "slices": SLICES,
        "hotspots": hotspots,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", type=Path, help="where to write the sample file")
    parser.add_argument("--force", action="store_true", help="allow writing to the real hotspot path")
    args = parser.parse_args()

    target = args.path if args.path.is_absolute() else ROOT / args.path
    real_paths = {DEFAULT_HOTSPOT_PATH.resolve(), resolve_hotspot_path().resolve()}
    if target.resolve() in real_paths and not args.force:
        print(f"Refusing to write to the real hotspot path {target}. Pass --force to overwrite it.")
        sys.exit(1)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(build_sample(), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote SAMPLE hotspot file ({SAMPLE_METHOD}) to {target}")


if __name__ == "__main__":
    main()
