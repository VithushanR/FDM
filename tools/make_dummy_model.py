"""Builds a STAND-IN model with the real pipeline structure, trained on random data.

Its predictions mean nothing. It lets the app and its tests run until the real model file arrives.

Usage (from the repo root):
    python tools/make_dummy_model.py               -> models/dummy_pipeline.joblib
    python tools/make_dummy_model.py --precollision -> models/dummy_precollision_pipeline.joblib
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import joblib  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.compose import ColumnTransformer  # noqa: E402
from sklearn.ensemble import RandomForestClassifier  # noqa: E402
from sklearn.impute import SimpleImputer  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import OneHotEncoder, StandardScaler  # noqa: E402

from backend.config import CODE_LABELS_PATH  # noqa: E402
from backend.services.features import (  # noqa: E402
    CATEGORICAL_COLUMNS, DAY_OF_WEEK_VALUES, FLAG_COLUMNS, MODEL_COLUMNS, NUMERIC_COLUMNS, SEASONS,
    TIME_BUCKETS, VEHICLE_COLUMNS,
)
from backend.services.model_service import read_code_labels  # noqa: E402

# Used only when code_labels.json is missing. The banner says so.
FALLBACK_CODES = (1, 2, 3, 4, 5)
PRECOLLISION_DROP = frozenset(VEHICLE_COLUMNS) | {
    "vehicle_type_diversity", "number_of_vehicles", "min_driver_age", "max_driver_age",
    "avg_driver_age", "latitude", "longitude",
}
OUT_DIR = ROOT / "models"
BANNER = (
    "STAND-IN MODEL: trained on random data. Its predictions mean nothing. "
    "Do not use it for any real decision."
)


def category_values(labels: dict) -> dict[str, list]:
    values: dict[str, list] = {}
    for column in CATEGORICAL_COLUMNS:
        if column == "season":
            values[column] = list(SEASONS)
        elif column == "time_of_day_bucket":
            values[column] = list(TIME_BUCKETS)
        elif column == "day_of_week":
            values[column] = list(DAY_OF_WEEK_VALUES)
        else:
            codes = [int(key) if key.lstrip("-").isdigit() else key for key in labels.get(column, {}) if key != "-1"]
            values[column] = codes or list(FALLBACK_CODES)
    return values


def make_training_frame(columns: list[str], categories: dict[str, list], seed: int, rows: int = 800,
                        pass_through: frozenset = frozenset()):
    rng = np.random.default_rng(seed)
    data: dict[str, object] = {}
    for column in columns:
        if column in pass_through:
            # The real model passes trunk_road_flag through as the DfT codes 1 and 2.
            data[column] = rng.choice([1.0, 2.0], rows)
        elif column in CATEGORICAL_COLUMNS:
            data[column] = pd.Series(rng.choice(np.array(categories[column], dtype=object), rows), dtype=object)
        elif column in FLAG_COLUMNS:
            data[column] = rng.integers(0, 2, rows).astype(float)
        elif column == "latitude":
            data[column] = rng.uniform(49, 61, rows)
        elif column == "longitude":
            data[column] = rng.uniform(-9, 2.5, rows)
        elif column == "speed_limit":
            data[column] = rng.choice([20.0, 30.0, 40.0, 50.0, 60.0, 70.0], rows)
        else:
            data[column] = rng.normal(size=rows)
    frame = pd.DataFrame(data, columns=columns)
    for column in columns:
        # Some missing values, so the imputers have something to learn from.
        frame.loc[rng.random(rows) < 0.05, column] = np.nan
    labels_y = rng.choice([1, 2, 3], size=rows, p=[0.15, 0.30, 0.55])
    return frame, labels_y


def build_pipeline(
    precollision: bool = False,
    seed: int = 0,
    classifier=None,
    labels_path: Path = CODE_LABELS_PATH,
    category_overrides: dict[str, list] | None = None,
    pass_through_trunk: bool = False,
    short_group_names: bool = False,
):
    """classifier=None gives the random forest. Tests pass another estimator to check the SVM-style path.
    category_overrides replaces the values a categorical column is trained on, for tests of the encoder checks.
    pass_through_trunk puts trunk_road_flag in the flag group as a number, as the real model does.
    short_group_names uses the real model's group names, num/cat/flag, instead of numeric/cat/flags."""
    labels, _ = read_code_labels(labels_path)
    categories = category_values(labels)
    categories.update(category_overrides or {})
    pass_through = frozenset({"trunk_road_flag"}) if pass_through_trunk else frozenset()
    columns = [c for c in MODEL_COLUMNS if not (precollision and c in PRECOLLISION_DROP)]
    numeric = [c for c in NUMERIC_COLUMNS if c in columns]
    categorical = [c for c in CATEGORICAL_COLUMNS if c in columns and c not in pass_through]
    flags = [c for c in FLAG_COLUMNS + tuple(sorted(pass_through)) if c in columns]
    names = ("num", "cat", "flag") if short_group_names else ("numeric", "cat", "flags")
    preprocessor = ColumnTransformer([
        (names[0], Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
        ]), numeric),
        (names[1], Pipeline([
            ("impute", SimpleImputer(strategy="most_frequent")),
            ("ohe", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]), categorical),
        (names[2], SimpleImputer(strategy="most_frequent"), flags),
    ])
    if classifier is None:
        classifier = RandomForestClassifier(n_estimators=50, class_weight="balanced_subsample", random_state=seed)
    pipeline = Pipeline([("preprocessor", preprocessor), ("classifier", classifier)])
    frame, y = make_training_frame(columns, categories, seed, pass_through=pass_through)
    return pipeline.fit(frame, y)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--precollision", action="store_true", help="drop vehicle, driver and location columns")
    args = parser.parse_args()

    _, label_warning = read_code_labels(CODE_LABELS_PATH)
    name = "dummy_precollision_pipeline.joblib" if args.precollision else "dummy_pipeline.joblib"
    out_path = OUT_DIR / name
    OUT_DIR.mkdir(exist_ok=True)

    print("=" * len(BANNER))
    print(BANNER)
    print("=" * len(BANNER))
    if label_warning:
        print(f"Note: {label_warning} Category codes are placeholders 1 to 5 for this stand-in.")
    pipeline = build_pipeline(precollision=args.precollision)
    joblib.dump(pipeline, out_path)
    print(f"Saved {out_path.relative_to(ROOT)} with {len(pipeline.feature_names_in_)} input columns.")


if __name__ == "__main__":
    main()
