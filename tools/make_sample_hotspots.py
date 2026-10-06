"""Writes a clearly labelled SAMPLE hotspot file, for tests and for trying the API before real results exist.

Usage (from the repo root):
    python tools/make_sample_hotspots.py tests/data/sample_hotspots.json        # version 1, as before
    python tools/make_sample_hotspots.py tests/data/v2/hotspots.json --v2       # version 2 plus profiles

A version 2 sample writes its profile file next to it, as hotspot_profiles.json.gz.
It refuses to write to the real hotspot path (or the real profile file) unless --force is given.
"""

import argparse
import gzip
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from backend.config import DEFAULT_HOTSPOT_PATH, resolve_hotspot_path  # noqa: E402
from backend.services.hotspot_service import PROFILES_NAME  # noqa: E402

SUBSETS = ["all", "severe"]
SLICES = ["All times", "Night", "Morning Rush", "Midday", "Evening Rush", "Evening"]
TIME_SLICES = SLICES[1:]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
PERSISTENCE_LABELS = ["Persistent", "Recent", "Fading", "Mixed", "Too few to judge"]
SHARE_KEYS = ["motorcycle", "pedal_cycle", "hgv", "pedestrian", "dark", "wet_icy", "junction", "rural"]
SHARE_LABELS = ["Motorcycle involved", "Pedal cycle involved", "Heavy goods vehicle involved", "Pedestrian involved",
                "In darkness", "Wet, icy or flooded road", "At a junction", "Rural area"]
PERSISTENCE_RULES = {
    "too_few_to_judge": "fewer than 8 collisions",
    "persistent": "collisions in at least 4 of the 5 years",
    "recent": "at least 60% of collisions in 2024 and 2025",
    "fading": "at least 60% of collisions in 2021 and 2022",
    "mixed": "none of the above",
}
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


def _split(total: int, parts: int, rng: np.random.Generator) -> list[int]:
    """Splits total into parts whole numbers that add up to total exactly."""
    if total == 0:
        return [0] * parts
    cuts = np.sort(rng.integers(0, total + 1, size=parts - 1))
    edges = np.concatenate([[0], cuts, [total]])
    return [int(value) for value in np.diff(edges)]


def _persistence(collisions: int, years: list[int]) -> tuple[str, int]:
    years_present = sum(1 for value in years if value > 0)
    if collisions < 8:
        return "Too few to judge", years_present
    if years_present >= 4:
        return "Persistent", years_present
    if (years[3] + years[4]) / collisions >= 0.6:
        return "Recent", years_present
    if (years[0] + years[1]) / collisions >= 0.6:
        return "Fading", years_present
    return "Mixed", years_present


def build_sample_v2(seed: int = 11, per_group: int = 6) -> tuple[dict, dict]:
    """A deterministic version 2 sample with a profile for every hotspot. Every rule in the contract holds."""
    rng = np.random.default_rng(seed)
    rows: list[dict] = []
    profiles: dict[str, dict] = {}
    groups: list[tuple[str, str, int | None]] = []
    for subset in SUBSETS:
        for slice_name in SLICES:
            groups += [(subset, slice_name, None)] * per_group
        for month in range(1, 13):
            groups += [(subset, "All times", month)] * 2

    for subset, slice_name, month in groups:
        row_id = len(rows) + 1
        collisions = int(rng.integers(1, 41)) if rng.random() > 0.2 else int(rng.integers(1, 8))
        if subset == "severe":
            fatal = int(rng.integers(0, collisions + 1))
            serious = collisions - fatal
            slight = 0
        else:
            fatal = int(rng.integers(0, max(collisions // 4, 0) + 1))
            serious = int(rng.integers(0, collisions - fatal + 1))
            slight = collisions - fatal - serious
        years = _split(collisions, 5, rng)
        months = [0] * 12
        if month is None:
            months = _split(collisions, 12, rng)
        else:
            months[month - 1] = collisions
        if slice_name == "All times":
            times = _split(collisions, 5, rng)
        else:
            times = [0] * 5
            times[TIME_SLICES.index(slice_name)] = collisions
        persistence, years_present = _persistence(collisions, years)
        rows.append({
            "id": row_id,
            "subset": subset,
            "slice": slice_name,
            "month": month,
            "latitude": round(float(rng.uniform(50.0, 58.0)), 6),
            "longitude": round(float(rng.uniform(-5.0, 1.0)), 6),
            "radius_m": int(rng.integers(25, 501)),
            "collisions": collisions,
            "fatal": fatal,
            "serious": serious,
            "slight": slight,
            "label": None if row_id % 5 == 0 else f"LSOA E0100{row_id:04d}",
            "years_present": years_present,
            "persistence": persistence,
        })
        profiles[str(row_id)] = {
            "y": years,
            "m": months,
            "t": times,
            "s": [int(rng.integers(0, collisions + 1)) for _ in SHARE_KEYS],
        }

    generated = datetime.now(timezone.utc).isoformat()
    hotspots = {
        "version": 2,
        "generated_at": generated,
        "method": SAMPLE_METHOD,
        "parameters": {"sample": True, "persistence_rules": PERSISTENCE_RULES, "month_views": "sample"},
        "subsets": SUBSETS,
        "slices": SLICES,
        "months": MONTHS,
        "persistence_labels": PERSISTENCE_LABELS,
        "features": {"months": True, "persistence": True, "profiles": True},
        "hotspots": rows,
    }
    baseline = {
        "all": {key: 20.0 for key in SHARE_KEYS},
        "severe": {key: 30.0 for key in SHARE_KEYS},
    }
    profile_file = {
        "version": 2,
        "generated_at": generated,
        "years": [2021, 2022, 2023, 2024, 2025],
        "months": list(range(1, 13)),
        "time_slices": TIME_SLICES,
        "share_keys": SHARE_KEYS,
        "share_labels": SHARE_LABELS,
        "baseline_pct": baseline,
        "profiles": profiles,
    }
    return hotspots, profile_file


def _refuse_real(target: Path, force: bool) -> bool:
    """True when the target is a real file that must not be overwritten."""
    real = {DEFAULT_HOTSPOT_PATH.resolve(), resolve_hotspot_path().resolve()}
    real |= {path.with_name(PROFILES_NAME).resolve() for path in list(real)}
    return target.resolve() in real and not force


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", type=Path, help="where to write the sample file")
    parser.add_argument("--v2", action="store_true", help="write a version 2 sample with its profile file")
    parser.add_argument("--force", action="store_true", help="allow writing to the real hotspot path")
    args = parser.parse_args()

    target = args.path if args.path.is_absolute() else ROOT / args.path
    if _refuse_real(target, args.force):
        print(f"Refusing to write to the real hotspot path {target}. Pass --force to overwrite it.")
        sys.exit(1)

    target.parent.mkdir(parents=True, exist_ok=True)
    if args.v2:
        hotspots, profiles = build_sample_v2()
        target.write_text(json.dumps(hotspots) + "\n", encoding="utf-8")
        profile_path = target.with_name(PROFILES_NAME)
        with gzip.open(profile_path, "wt", encoding="utf-8") as handle:
            json.dump(profiles, handle)
        print(f"Wrote SAMPLE version 2 hotspot file ({SAMPLE_METHOD}) to {target}")
        print(f"Wrote the profile file to {profile_path}")
    else:
        target.write_text(json.dumps(build_sample(), indent=2) + "\n", encoding="utf-8")
        print(f"Wrote SAMPLE hotspot file ({SAMPLE_METHOD}) to {target}")


if __name__ == "__main__":
    main()
