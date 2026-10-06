"""Checks backend/services/features.py against columns already derived in a training CSV.

Usage (from the repo root):
    python tools/check_feature_logic.py data/processed/train.csv

Exit code 1 means at least one check has mismatches. A check whose columns are absent is skipped, not failed.
Rows with a blank input for a check are skipped for that check.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from backend.services.features import (  # noqa: E402
    VEHICLE_COLUMNS, hour_sin_cos, month_sin_cos, season_for_month, time_bucket_for_hour,
)

TOLERANCE = 1e-6
DRIVER_AGES = ("min_driver_age", "avg_driver_age", "max_driver_age")


def _match_index(sin_values: np.ndarray, cos_values: np.ndarray, count: int, formula) -> np.ndarray:
    """Index of the matching value (0-based) for each row, or -1 when no value of the formula fits."""
    table = np.array([formula(value) for value in range(count)])
    distance = (sin_values[:, None] - table[None, :, 0]) ** 2 + (cos_values[:, None] - table[None, :, 1]) ** 2
    best = distance.argmin(axis=1)
    return np.where(distance.min(axis=1) < TOLERANCE ** 2, best, -1)


def _need(frame: pd.DataFrame, columns: list[str]) -> bool:
    if all(column in frame.columns for column in columns):
        return True
    print(f"  skipped: {', '.join(c for c in columns if c not in frame.columns)} not in the CSV")
    return False


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python tools/check_feature_logic.py <train csv>")
        sys.exit(2)
    frame = pd.read_csv(sys.argv[1])
    failed = []

    def report(name: str, checked: int, mismatches: int, skipped: int) -> None:
        print(f"{name}: {checked} checked, {mismatches} mismatches, {skipped} skipped (blank input)")
        if mismatches:
            failed.append(name)

    print("Month and season")
    if _need(frame, ["month_sin", "month_cos"]):
        valid = frame[["month_sin", "month_cos"]].notna().all(axis=1).to_numpy()
        sub = frame[valid]
        months = _match_index(sub["month_sin"].to_numpy(float), sub["month_cos"].to_numpy(float), 12,
                              lambda v: month_sin_cos(v + 1))
        report("month_sin/month_cos match 2*pi*month/12", len(sub), int((months < 0).sum()), int((~valid).sum()))
        if _need(frame, ["season"]):
            matched = months >= 0
            expected = np.array([season_for_month(m + 1) for m in range(12)])
            season_ok = expected[months[matched]] == sub["season"].to_numpy()[matched]
            report("season matches the month", int(matched.sum()), int((~season_ok).sum()), 0)

    print("Hour and time of day")
    if _need(frame, ["hour_of_day_sin", "hour_of_day_cos"]):
        valid = frame[["hour_of_day_sin", "hour_of_day_cos"]].notna().all(axis=1).to_numpy()
        sub = frame[valid]
        hours = _match_index(sub["hour_of_day_sin"].to_numpy(float), sub["hour_of_day_cos"].to_numpy(float), 24,
                             lambda v: hour_sin_cos(v))
        report("hour_of_day_sin/cos match 2*pi*hour/24", len(sub), int((hours < 0).sum()), int((~valid).sum()))
        if _need(frame, ["time_of_day_bucket"]):
            matched = hours >= 0
            expected = np.array([time_bucket_for_hour(h) for h in range(24)])
            bucket_ok = expected[hours[matched]] == sub["time_of_day_bucket"].to_numpy()[matched]
            report("time_of_day_bucket matches the hour", int(matched.sum()), int((~bucket_ok).sum()), 0)

    print("Weekend and vehicles")
    if _need(frame, ["day_of_week", "is_weekend"]):
        valid = frame[["day_of_week", "is_weekend"]].notna().all(axis=1)
        sub = frame[valid]
        expected = sub["day_of_week"].astype(int).isin([1, 7]).astype(int)
        report("is_weekend matches day_of_week (1 and 7)", len(sub),
               int((expected != sub["is_weekend"].astype(int)).sum()), int((~valid).sum()))
    if _need(frame, ["vehicle_type_diversity", *VEHICLE_COLUMNS]):
        valid = frame[["vehicle_type_diversity", *VEHICLE_COLUMNS]].notna().all(axis=1)
        sub = frame[valid]
        summed = sub[list(VEHICLE_COLUMNS)].sum(axis=1).astype(int)
        report("vehicle_type_diversity equals the sum of the has_* flags", len(sub),
               int((summed != sub["vehicle_type_diversity"].astype(int)).sum()), int((~valid).sum()))

    print("Driver ages")
    if _need(frame, list(DRIVER_AGES)):
        valid = frame[list(DRIVER_AGES)].notna().all(axis=1)
        sub = frame[valid]
        ordered = (sub["min_driver_age"] <= sub["avg_driver_age"]) & (sub["avg_driver_age"] <= sub["max_driver_age"])
        report("min <= avg <= max driver age", len(sub), int((~ordered).sum()), int((~valid).sum()))

    if failed:
        print(f"\nFAILED: {len(failed)} check(s) have mismatches.")
        sys.exit(1)
    print("\nAll checks that ran passed.")


if __name__ == "__main__":
    main()
