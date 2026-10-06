"""The command-line tools, run the way a user would run them."""

import json
import os
import subprocess
import sys
from datetime import date, time
from pathlib import Path

import numpy as np
import pandas as pd

from backend.services.features import build_row
from tools.make_sample_hotspots import build_sample

ROOT = Path(__file__).resolve().parent.parent


def run_tool(*args, env_extra=None):
    env = {**os.environ, **(env_extra or {})}
    return subprocess.run(
        [sys.executable, *args], cwd=ROOT, capture_output=True, text=True, env=env, timeout=300,
    )


def derived_rows(count_days: int = 40) -> pd.DataFrame:
    rows = []
    for day_offset in range(0, count_days * 9, 9):
        day = date.fromordinal(date(2024, 1, 1).toordinal() + day_offset)
        for hour in (0, 7, 12, 17, 22):
            answers = {"date": day, "time": time(hour, 0), "vehicles": ["car", "hgv"], "driver_ages": [20, 45]}
            rows.append(build_row(answers))
    return pd.DataFrame(rows)


def test_check_feature_logic_passes_on_consistent_data(tmp_path):
    csv = tmp_path / "train.csv"
    derived_rows().to_csv(csv, index=False)
    result = run_tool("tools/check_feature_logic.py", str(csv))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "0 mismatches" in result.stdout


def test_check_feature_logic_fails_on_a_wrong_season(tmp_path):
    frame = derived_rows()
    frame.loc[0, "season"] = "Summer"  # January is Winter
    csv = tmp_path / "train.csv"
    frame.to_csv(csv, index=False)
    result = run_tool("tools/check_feature_logic.py", str(csv))
    assert result.returncode == 1
    assert "FAILED" in result.stdout


def test_compute_test_metrics_scores_a_csv_with_the_app_code_path(tmp_path, dummy_model_path):
    frame = derived_rows()
    rng = np.random.default_rng(1)
    frame["collision_severity"] = rng.choice([1, 2, 3], len(frame))
    csv = tmp_path / "test.csv"
    frame.to_csv(csv, index=False)
    result = run_tool("tools/compute_test_metrics.py", str(csv), env_extra={"MODEL_PATH": str(dummy_model_path)})
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Confusion matrix" in result.stdout
    assert "Macro F1" in result.stdout


def test_compute_test_metrics_reports_missing_columns(tmp_path, dummy_model_path):
    frame = derived_rows().drop(columns=["latitude"])
    frame["collision_severity"] = 1
    csv = tmp_path / "test.csv"
    frame.to_csv(csv, index=False)
    result = run_tool("tools/compute_test_metrics.py", str(csv), env_extra={"MODEL_PATH": str(dummy_model_path)})
    assert result.returncode == 1
    assert "latitude" in result.stdout


def test_validate_hotspots_accepts_a_good_file_and_lists_every_problem_in_a_bad_one(tmp_path):
    good = tmp_path / "good.json"
    good.write_text(json.dumps(build_sample()), encoding="utf-8")
    result = run_tool("tools/validate_hotspots.py", str(good))
    assert result.returncode == 0, result.stdout
    assert "SAMPLE" in result.stdout

    data = build_sample()
    data["hotspots"][0]["collisions"] = 999
    data["hotspots"][1]["latitude"] = 10.0
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps(data), encoding="utf-8")
    result = run_tool("tools/validate_hotspots.py", str(bad))
    assert result.returncode == 1
    assert "hotspots[0]" in result.stdout and "hotspots[1]" in result.stdout
    assert "2 problem(s)" in result.stdout
