"""Scores a test CSV with the app's own code path and prints the metrics. Optionally stores precision and recall.

Usage (from the repo root):
    python tools/compute_test_metrics.py data/processed/test.csv
    python tools/compute_test_metrics.py data/processed/test.csv --write

The CSV needs every input column the model expects, plus the true severity column (see --target).
--write only updates precision and recall under performance.per_class. Every other key is kept.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support  # noqa: E402

from backend.config import CODE_LABELS_PATH, MODEL_CONFIG_PATH, load_model_config, resolve_model_path  # noqa: E402
from backend.services.model_service import ModelService  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("test_csv", type=Path)
    parser.add_argument("--target", default="collision_severity", help="name of the true severity column")
    parser.add_argument("--write", action="store_true", help="store precision and recall in model_config.json")
    args = parser.parse_args()

    config = load_model_config()
    service = ModelService(resolve_model_path(config), config, CODE_LABELS_PATH)
    if not service.loaded:
        print(f"Cannot score: {service.error}")
        sys.exit(1)

    frame_in = pd.read_csv(args.test_csv)
    missing = [c for c in service.columns + [args.target] if c not in frame_in.columns]
    if missing:
        print(f"The CSV is missing columns: {', '.join(missing)}")
        sys.exit(1)

    rows = frame_in.dropna(subset=[args.target])
    dropped = len(frame_in) - len(rows)
    y_true = rows[args.target].astype(int).to_numpy()
    classes = service.classes
    unknown = ~np.isin(y_true, classes)
    if unknown.any():
        print(f"{int(unknown.sum())} rows have a true severity outside {classes} and are skipped.")
        y_true, rows = y_true[~unknown], rows[~unknown]
    if len(rows) == 0:
        print("No rows left to score.")
        sys.exit(1)

    _, _, indices = service.score_frame(service.to_frame(rows[service.columns].to_dict("records")))
    y_pred = np.asarray(classes)[indices]

    matrix = confusion_matrix(y_true, y_pred, labels=classes)
    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=classes, zero_division=0,
    )
    names = [service.class_name(code) for code in classes]
    macro_f1 = float(f1.mean())

    print(f"Scored {len(rows)} rows ({dropped} rows with no true severity were dropped).")
    print("\nConfusion matrix (rows = true, columns = predicted):")
    print(pd.DataFrame(matrix, index=[f"true {n}" for n in names], columns=[f"pred {n}" for n in names]).to_string())
    print()
    print(pd.DataFrame({
        "precision": precision.round(4), "recall": recall.round(4), "f1": f1.round(4), "support": support,
    }, index=names).to_string())
    print(f"\nMacro F1: {macro_f1:.4f}")

    recorded = config.get("performance", {}).get("per_class", {})
    for index, name in enumerate(names):
        stored = recorded.get(name, {}).get("recall")
        if stored is not None and abs(stored - recall[index]) > 0.0005:
            print(f"Note: recall for {name} is {recall[index]:.4f} here, but model_config.json has {stored}.")

    if args.write:
        per_class = config.setdefault("performance", {}).setdefault("per_class", {})
        for index, name in enumerate(names):
            entry = per_class.setdefault(name, {})
            entry["precision"] = round(float(precision[index]), 4)
            entry["recall"] = round(float(recall[index]), 4)
        MODEL_CONFIG_PATH.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        print(f"Stored precision and recall in {MODEL_CONFIG_PATH.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
