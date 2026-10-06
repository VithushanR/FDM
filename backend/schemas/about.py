"""Checks backend/resources/about.json at startup. The numbers on the About page must agree with each other."""

import json
from pathlib import Path
from typing import Any


class AboutFileError(Exception):
    pass


def validate_about(data: Any) -> dict:
    """Returns the data if it is consistent. Raises AboutFileError naming the first problem found."""
    try:
        results = data["test_results"]
        matrix = results["confusion_matrix_rows_true_columns_predicted"]
        classes = results["classes"]
        per_class = results["per_class"]
        splits = data["data"]["splits"]
        collisions = data["data"]["collisions"]
    except (KeyError, TypeError) as exc:
        raise AboutFileError(f"about.json is missing a required key: {exc}") from exc
    if len(matrix) != len(classes):
        raise AboutFileError("the confusion matrix must have one row per class")
    for row, name in zip(matrix, classes):
        if len(row) != len(classes):
            raise AboutFileError(f"the confusion matrix row for {name} must have one column per class")
        support = per_class[name]["support"]
        if sum(row) != support:
            raise AboutFileError(f"the confusion matrix row for {name} sums to {sum(row)}, but its support is {support}")
    if sum(splits.values()) != collisions:
        raise AboutFileError(f"the splits sum to {sum(splits.values())}, but collisions is {collisions}")
    return data


def load_about(path: Path) -> dict:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise AboutFileError(f"{path.name} was not found") from exc
    except json.JSONDecodeError as exc:
        raise AboutFileError(f"{path.name} is not valid JSON ({exc})") from exc
    return validate_about(raw)
