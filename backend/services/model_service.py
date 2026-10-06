"""Loads the pipeline, checks it against the form, validates answers and predicts.

The app never stops because of a bad model. Problems are stored as self.error and
reported by the routers as 503.
"""

from __future__ import annotations

import json
import math
import re
import warnings
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import Request
from sklearn.compose import ColumnTransformer
from sklearn.exceptions import InconsistentVersionWarning
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from .features import (
    CATEGORICAL_COLUMNS, DAY_OF_WEEK_VALUES, FORM_FIELDS, LEAKAGE_COLUMNS, LEAKAGE_PATTERN, MAX_AGE,
    MODEL_COLUMNS, OPTIONAL_ENCODING, SEASONS, TIME_BUCKETS, FieldSpec, build_row, normalise_code,
    parse_date, parse_time,
)

SCORE_METHODS = ("predict_proba", "decision_function")
ADJUST_MODES = ("multiply", "add")
REQUIRED = "This field is required."
BAD_OPTION = "Choose one of the listed options."
FORM_ORDER = {spec.name: index for index, spec in enumerate(FORM_FIELDS)}


def read_code_labels(path: Path) -> tuple[dict[str, dict[str, str]], str | None]:
    """Labels are keyed by field name, then by code as a string. A missing file is a warning, not an error."""
    if not path.exists():
        return {}, f"{path.name} was not found, so category options show as 'Code N'."
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {}, f"{path.name} is not valid JSON ({exc}), so category options show as 'Code N'."
    if not isinstance(data, dict):
        return {}, f"{path.name} must be a JSON object, so category options show as 'Code N'."
    labels = {
        str(field): {str(code): str(text) for code, text in mapping.items()}
        for field, mapping in data.items() if isinstance(mapping, dict)
    }
    return labels, None


def decide(raw: np.ndarray, classes: list[int], fatal_index: int, adjust_mode: str, fatal_adjust: float):
    """The decision rule used by the app and by the metrics tool. Returns adjusted scores and the chosen index per row."""
    adjusted = raw.astype(float).copy()
    if adjust_mode == "multiply":
        adjusted[:, fatal_index] = raw[:, fatal_index] * fatal_adjust
    else:
        adjusted[:, fatal_index] = raw[:, fatal_index] + fatal_adjust
    return adjusted, adjusted.argmax(axis=1)


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return not value
    return False


def _select_names(names: list[str], selector: Any) -> list[str]:
    """Column selectors as ColumnTransformer stores them: a name, a list of names, indices or a boolean mask."""
    if isinstance(selector, str):
        return [selector]
    if isinstance(selector, slice):
        return names[selector]
    items = list(selector)
    if items and all(isinstance(item, (bool, np.bool_)) for item in items):
        return [name for name, keep in zip(names, items) if keep]
    if items and all(isinstance(item, (int, np.integer)) for item in items):
        return [names[int(index)] for index in items]
    return [str(item) for item in items]


def _plural(count: int, word: str) -> str:
    return word if count == 1 else f"{word}s"


def _is_number(text: str) -> bool:
    try:
        float(text)
    except ValueError:
        return False
    return True


def _numeric_sort_key(key: str) -> tuple[int, float, str]:
    """Numeric codes sort by value first; text codes come after them, alphabetically."""
    return (0, float(key), "") if _is_number(key) else (1, 0.0, key)


class ModelService:
    def __init__(self, model_path: Path, config: dict, labels_path: Path):
        self.model_path = model_path
        self.config = config
        self.model_name = config.get("model_name", "Model")
        self.demo = "dummy" in model_path.name.lower()
        self.class_names = {str(code): name for code, name in config.get("classes", {}).items()}
        self.warnings: list[str] = []
        self.error: str | None = None
        self.pipeline = None
        self.columns: list[str] = []
        self.classes: list[int] = []
        self.fatal_index = 0
        self.fields: list[FieldSpec] = []
        self.field_options: dict[str, list[tuple[str, str]]] = {}
        self.encoder_categories: dict[str, list[Any]] = {}
        self.category_lookup: dict[str, dict[str, Any]] = {}
        self.labels, label_warning = read_code_labels(labels_path)
        if label_warning:
            self.warnings.append(label_warning)
        if self.demo:
            self.warnings.append("This is a stand-in model trained on random data. Its predictions mean nothing.")
        try:
            self._load()
        except ValueError as exc:
            self.error = str(exc)
        except Exception as exc:  # the server must still start, whatever the model file contains
            self.error = f"The model could not be checked: {type(exc).__name__}: {exc}"

    @property
    def loaded(self) -> bool:
        return self.error is None and self.pipeline is not None

    @property
    def score_method(self) -> str:
        return self.config.get("score_method", "predict_proba")

    @property
    def score_kind(self) -> str:
        return "probability" if self.score_method == "predict_proba" else "score"

    @property
    def adjust_mode(self) -> str:
        return self.config.get("adjust_mode", "multiply")

    @property
    def fatal_adjust(self) -> float:
        return float(self.config.get("fatal_adjust", 1.0))

    # Loading and self-checks

    def _load(self) -> None:
        if self.config.get("score_method") not in SCORE_METHODS:
            raise ValueError(f"score_method in model_config.json must be one of {', '.join(SCORE_METHODS)}.")
        if self.config.get("adjust_mode") not in ADJUST_MODES:
            raise ValueError(f"adjust_mode in model_config.json must be one of {', '.join(ADJUST_MODES)}.")
        if not self.model_path.exists():
            raise ValueError(
                f"Model file not found at {self.model_path}. "
                "Copy rf_classifier_pipeline.joblib into models/ or set MODEL_PATH."
            )
        pipeline = self._read_pipeline()
        if not isinstance(pipeline, Pipeline):
            raise ValueError(f"Expected a scikit-learn Pipeline in the model file, found {type(pipeline).__name__}.")
        column_transformer = next((step for _, step in pipeline.steps if isinstance(step, ColumnTransformer)), None)
        if column_transformer is None:
            raise ValueError("The pipeline has no ColumnTransformer step, so its input columns cannot be checked.")
        names = getattr(pipeline, "feature_names_in_", None)
        if names is None:
            names = getattr(column_transformer, "feature_names_in_", None)
        if names is None:
            raise ValueError("The model was not trained on a DataFrame, so its input column names are unknown.")
        self.columns = [str(name) for name in names]
        self._check_columns()
        self._read_classes(pipeline)
        if not hasattr(pipeline, self.score_method):
            other = "decision_function" if self.score_method == "predict_proba" else "predict_proba"
            raise ValueError(f"The model has no {self.score_method}. Set score_method to {other} in model_config.json.")
        self.pipeline = pipeline
        self._collect_encoders(column_transformer)
        self._build_lookups()
        self._check_encoded_categories()
        self._build_fields()

    def _read_pipeline(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            try:
                pipeline = joblib.load(self.model_path)
            except Exception as exc:
                raise ValueError(f"Could not load the model file: {exc}") from exc
        # sklearn warns once per estimator, so keep only the first one.
        version = next((w.message for w in caught if issubclass(w.category, InconsistentVersionWarning)), None)
        if version is not None:
            self.warnings.append(
                f"The model was saved with scikit-learn {version.original_sklearn_version}, but "
                f"{version.current_sklearn_version} is installed. Predictions may differ from training; "
                "install the matching version."
            )
        return pipeline

    def _check_columns(self) -> None:
        leakage = [c for c in self.columns if c in LEAKAGE_COLUMNS or LEAKAGE_PATTERN.match(c)]
        if leakage:
            raise ValueError(
                f"The model uses leakage columns that must never be inputs: {', '.join(leakage)}. Retrain without them."
            )
        unknown = [c for c in self.columns if c not in MODEL_COLUMNS]
        if unknown:
            raise ValueError(
                f"The model expects columns the form cannot produce: {', '.join(unknown)}. "
                "Retrain without them, or add them to backend/services/features.py."
            )

    def _read_classes(self, pipeline) -> None:
        try:
            self.classes = [int(code) for code in pipeline.classes_]
        except (TypeError, ValueError) as exc:
            raise ValueError("The model's classes must be whole-number codes such as 1, 2 and 3.") from exc
        if 1 not in self.classes:
            raise ValueError("The model has no Fatal class (code 1).")
        self.fatal_index = self.classes.index(1)

    def _collect_encoders(self, step, names: list[str] | None = None) -> None:
        """Find every OneHotEncoder by walking the pipeline, so step names do not matter."""
        names = self.columns if names is None else names
        if isinstance(step, OneHotEncoder):
            for column, categories in zip(names, step.categories_):
                if column in self.columns:
                    self.encoder_categories[column] = list(categories)
        elif isinstance(step, Pipeline):
            for _, sub_step in step.steps:
                self._collect_encoders(sub_step, names)
        elif isinstance(step, ColumnTransformer):
            for _, sub_step, selector in step.transformers_:
                self._collect_encoders(sub_step, _select_names(names, selector))
    def _build_lookups(self) -> None:
        for column, categories in self.encoder_categories.items():
            lookup = {}
            for category in categories:
                key = normalise_code(category)
                if key is not None:
                    lookup.setdefault(key, category)
            self.category_lookup[column] = lookup

    def _check_encoded_categories(self) -> None:
        missing_encoders = [
            c for c in CATEGORICAL_COLUMNS
            if c in self.columns and c not in self.category_lookup and c not in OPTIONAL_ENCODING
        ]
        if missing_encoders:
            raise ValueError(
                "These columns are not one-hot encoded by the model, but the form sends them as categories: "
                f"{', '.join(missing_encoders)}."
            )
        for column, expected in (
            ("season", SEASONS), ("time_of_day_bucket", TIME_BUCKETS), ("day_of_week", DAY_OF_WEEK_VALUES),
        ):
            if column not in self.category_lookup:
                continue
            unknown = [str(value) for value in expected if normalise_code(value) not in self.category_lookup[column]]
            if unknown:
                self.warnings.append(
                    f"The model's encoder for {column} does not know {', '.join(unknown)}. "
                    "Collisions with those values would be encoded as all zeros."
                )

    def _build_fields(self) -> None:
        used = set(self.columns)
        for spec in FORM_FIELDS:
            if not used.intersection(spec.columns):
                continue
            if spec.kind == "select" and spec.dynamic_options:
                if spec.columns[0] in self.category_lookup:
                    choices = self._category_choices(spec)
                elif spec.columns[0] in OPTIONAL_ENCODING:
                    # Passed through as a number: the codes come from config and the field is never hidden.
                    choices = self._flag_choices(spec.columns[0])
                    if not choices:
                        self.warnings.append(
                            f"{spec.columns[0]} is passed through as a number and model_config.json has no "
                            f"flag_options for it, so the {spec.label} field has no choices."
                        )
                else:
                    choices = None
                if choices is None:
                    self.warnings.append(
                        f"The model has no one-hot encoder for {spec.columns[0]}, so the {spec.label} field is hidden."
                    )
                    continue
            elif spec.kind in ("select", "multicheck"):
                choices = list(spec.static_options)
            else:
                choices = []
            self.fields.append(spec)
            self.field_options[spec.name] = choices

    def _flag_choices(self, name: str) -> list[tuple[str, str]]:
        """Choices for a pass-through column, from flag_options in model_config.json. Codes are numbers, e.g. 1 and 2."""
        choices = []
        for entry in self.config.get("flag_options", {}).get(name, []):
            if not isinstance(entry, dict) or "value" not in entry or "label" not in entry:
                raise ValueError(f"flag_options.{name} entries need a value and a label.")
            key = normalise_code(entry["value"])
            if key is None or not _is_number(key):
                raise ValueError(f"flag_options.{name} values must be numbers, found {entry['value']!r}.")
            choices.append((key, str(entry["label"])))
        return choices

    def _category_choices(self, spec: FieldSpec) -> list[tuple[str, str]] | None:
        column = spec.columns[0]
        if column not in self.category_lookup:
            return None
        keys = [key for key in self.category_lookup[column] if key != "-1"]
        return [(key, self._option_label(spec.name, key)) for key in sorted(keys, key=_numeric_sort_key)]

    def _option_label(self, field: str, key: str) -> str:
        label = self.labels.get(field, {}).get(key)
        if label is not None:
            return label
        return f"Code {key}" if _is_number(key) else key

    # Validation

    def check_answers(self, values: dict[str, Any], errors: dict[str, str]):
        """Check the shown fields and return (answers, errors, left_blank). errors holds type errors already found."""
        errors = dict(errors)
        answers: dict[str, Any] = {}
        for spec in self.fields:
            if spec.name in errors:
                continue
            raw = values.get(spec.name)
            if _is_blank(raw):
                if spec.required:
                    errors[spec.name] = REQUIRED
                answers[spec.name] = None
                continue
            message, answer = self._check_value(spec, raw)
            if message:
                errors[spec.name] = message
            answers[spec.name] = answer
        self._check_pairs(answers, errors)
        left_blank = [
            spec.label for spec in self.fields
            if not spec.required and spec.name not in errors and _is_blank(values.get(spec.name))
        ]
        ordered = dict(sorted(errors.items(), key=lambda item: FORM_ORDER.get(item[0], len(FORM_ORDER))))
        return answers, ordered, left_blank

    def _check_value(self, spec: FieldSpec, raw: Any) -> tuple[str | None, Any]:
        if spec.kind == "date":
            day = parse_date(raw)
            return ("Enter a valid date.", None) if day is None else (None, day)
        if spec.kind == "time":
            clock = parse_time(raw)
            return ("Enter a valid time, for example 18:30.", None) if clock is None else (None, clock)
        if spec.kind == "select":
            key = normalise_code(raw)
            allowed = {value for value, _ in self.field_options[spec.name]}
            return (None, key) if key in allowed else (BAD_OPTION, None)
        if spec.kind == "integer":
            if not spec.min <= raw <= spec.max:
                return f"Enter a whole number from {int(spec.min)} to {int(spec.max)}.", None
            return None, int(raw)
        if spec.kind == "decimal":
            if not math.isfinite(raw) or not spec.min <= raw <= spec.max:
                return f"Enter a number from {spec.min:g} to {spec.max:g}.", None
            return None, float(raw)
        if spec.kind == "text":
            tokens = [token for token in re.split(r"[,;\s]+", raw.strip()) if token]
            if all(token.isdigit() and 1 <= int(token) <= MAX_AGE for token in tokens):
                return None, [int(token) for token in tokens]
            return (
                f"Enter driver ages as whole numbers from 1 to {MAX_AGE}, separated by commas, for example 34, 52.",
                None,
            )
        if spec.kind == "multicheck":
            allowed = {value for value, _ in self.field_options[spec.name]}
            if any(item not in allowed for item in raw):
                return BAD_OPTION, None
            return None, list(dict.fromkeys(raw))
        return None, raw

    def _check_pairs(self, answers: dict[str, Any], errors: dict[str, str]) -> None:
        shown = {spec.name for spec in self.fields}

        def clean(name: str) -> bool:
            return name in shown and name not in errors

        if clean("latitude") and clean("longitude"):
            lat_blank = answers.get("latitude") is None
            if lat_blank != (answers.get("longitude") is None):
                target = "latitude" if lat_blank else "longitude"
                errors[target] = "Enter latitude and longitude together, or leave both blank."

        count = answers.get("number_of_vehicles") if clean("number_of_vehicles") else None
        ticked = answers.get("vehicles") if clean("vehicles") else None
        ages = answers.get("driver_ages") if clean("driver_ages") else None

        if ticked and count is not None and count < len(ticked):
            types = len(ticked)
            errors.setdefault(
                "number_of_vehicles",
                f"You ticked {types} vehicle {_plural(types, 'type')}, so there must be at least "
                f"{types} {_plural(types, 'vehicle')}.",
            )
        if ages and count is not None and len(ages) > count:
            errors.setdefault(
                "driver_ages",
                f"You entered {len(ages)} driver ages for {count} {_plural(count, 'vehicle')}. "
                "Enter at most one age per vehicle.",
            )
        if ages and ticked and min(ages) < 10 and "pedal_cycle" not in ticked:
            errors.setdefault("driver_ages", "Ages under 10 are only allowed when a pedal cycle is involved.")

    # Prediction

    def to_frame(self, rows: list[dict[str, Any]]) -> pd.DataFrame:
        """Raw values to the model's input frame. Category values become the encoder's own objects so dtypes match."""
        data = {}
        for column in self.columns:
            values = [self._encode(column, row.get(column)) for row in rows]
            dtype = object if column in self.category_lookup else float
            data[column] = pd.Series(values, dtype=dtype)
        return pd.DataFrame(data, columns=self.columns)

    def _encode(self, column: str, value: Any) -> Any:
        if column in self.category_lookup:
            key = normalise_code(value)
            if key is None:
                return np.nan
            # An unknown value is passed through; the encoder then turns it into zeros, which the load-time warnings cover.
            return self.category_lookup[column].get(key, value)
        if isinstance(value, str):
            # A pass-through code chosen in the form arrives as text, e.g. "2". The model takes it as a number.
            key = normalise_code(value)
            return np.nan if key is None else int(float(key))
        return np.nan if value is None else value

    def score_frame(self, frame: pd.DataFrame):
        """Raw scores, adjusted scores and the chosen class index for every row."""
        raw = np.asarray(getattr(self.pipeline, self.score_method)(frame), dtype=float)
        adjusted, indices = decide(raw, self.classes, self.fatal_index, self.adjust_mode, self.fatal_adjust)
        return raw, adjusted, indices

    def class_name(self, code: int) -> str:
        return self.class_names.get(str(code), f"Code {code}")

    def _named(self, row: np.ndarray) -> dict[str, float]:
        return {self.class_name(code): round(float(score), 4) for code, score in zip(self.classes, row)}

    def predict(self, answers: dict[str, Any], left_blank: list[str]) -> dict[str, Any]:
        raw, adjusted, indices = self.score_frame(self.to_frame([build_row(answers)]))
        code = self.classes[int(indices[0])]
        return {
            "severity_code": code,
            "severity": self.class_name(code),
            "scores": self._named(raw[0]),
            "adjusted_scores": self._named(adjusted[0]),
            "score_kind": self.score_kind,
            "fatal_adjust": self.fatal_adjust,
            "adjust_mode": self.adjust_mode,
            "adjustment_note": self._adjustment_note(),
            "left_blank": left_blank,
        }

    def _adjustment_note(self) -> str:
        fatal = self.class_name(1)
        adjust = self.fatal_adjust
        if self.adjust_mode == "multiply":
            action = f"is multiplied by {adjust:g}"
            helps, hurts = adjust > 1, adjust < 1
        else:
            action = f"has {adjust:g} added to it"
            helps, hurts = adjust > 0, adjust < 0
        if helps:
            effect = f"so more {fatal} collisions are caught"
        elif hurts:
            effect = f"so fewer {fatal} collisions are caught"
        else:
            effect = f"so the {fatal} result is unchanged"
        return f"The {fatal} {self.score_kind} {action} before the result is chosen, {effect}."

    # Describing the form to the frontend

    def schema(self) -> dict[str, Any]:
        groups: list[dict[str, Any]] = []
        for spec in self.fields:
            if not groups or groups[-1]["title"] != spec.group:
                groups.append({"title": spec.group, "fields": []})
            groups[-1]["fields"].append({
                "name": spec.name,
                "label": spec.label,
                "kind": spec.kind,
                "required": spec.required,
                "help": spec.help,
                "options": [{"value": value, "label": label} for value, label in self.field_options[spec.name]],
                "min": spec.min,
                "max": spec.max,
                "placeholder": spec.placeholder,
            })
        return {
            "loaded": True,
            "demo": self.demo,
            "model_name": self.model_name,
            "classes": {str(code): name for code, name in self.class_names.items()},
            "score_kind": self.score_kind,
            "adjust_mode": self.adjust_mode,
            "fatal_adjust": self.fatal_adjust,
            "performance": self.config.get("performance", {}),
            "warnings": list(self.warnings),
            "groups": groups,
        }


def get_model_service(request: Request) -> ModelService:
    return request.app.state.model
