"""Shows exactly what the app sends to the model for one form, and checks it.

Usage (from the repo root):
    python tools/show_model_input.py                  # real model, example input, trunk = 2
    python tools/show_model_input.py --trunk 1
    python tools/show_model_input.py --trunk blank
    python tools/show_model_input.py --all-options    # also try every dropdown option in /api/schema
    python tools/show_model_input.py --json out.json  # also write everything as JSON
    python tools/show_model_input.py --model path.joblib  # another model file, e.g. a stand-in

It uses the app's own code path: parse_form, check_answers, build_row, to_frame, score_frame and predict.
It only reads the model. Nothing is written to models/.
Exit code 0 means every check passed.
"""

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
from sklearn.compose import ColumnTransformer  # noqa: E402

from backend.config import CODE_LABELS_PATH, load_model_config, resolve_model_path  # noqa: E402
from backend.schemas.classification import parse_form  # noqa: E402
from backend.services.features import (  # noqa: E402
    OPTIONAL_ENCODING, VEHICLE_COLUMNS, build_row, normalise_code,
)
from backend.services.model_service import ModelService  # noqa: E402

EXAMPLE_FORM = {
    "date": "2024-10-03",
    "time": "23:15",
    "road_type": 6,
    "urban_or_rural_area": 2,
    "junction_detail": 13,
    "light_conditions": 6,
    "weather_conditions": 2,
    "road_surface_conditions": 2,
    "speed_limit": "60",
    "number_of_vehicles": 2,
    "vehicles": ["car", "motorcycle"],
    "driver_ages": "34, 52",
    "trunk_road_flag": 2,
}
PREPROCESSED_NUMERIC = (
    "speed_limit", "latitude", "longitude", "number_of_vehicles",
    "min_driver_age", "max_driver_age", "avg_driver_age", "vehicle_type_diversity",
)
PREPROCESSED_SIN_COS = ("month_sin", "month_cos", "hour_of_day_sin", "hour_of_day_cos")
TIMING_RUNS = 20


def build_frame(service: ModelService, form: dict):
    """The same steps as POST /api/predict, up to the frame the model receives. Raises ValueError on bad input."""
    values, errors = parse_form(form)
    answers, errors, left_blank = service.check_answers(values, errors)
    if errors:
        raise ValueError(errors)
    return service.to_frame([build_row(answers)]), left_blank


def preprocessed_values(service: ModelService, frame) -> tuple[list[str], list[float]]:
    preprocessor = next(step for _, step in service.pipeline.steps if isinstance(step, ColumnTransformer))
    return list(preprocessor.get_feature_names_out()), list(preprocessor.transform(frame)[0])


def named_outputs(names: list[str], values: list[float], column: str) -> list[dict]:
    """Preprocessed outputs for one input column. Matches the name exactly or as a one-hot prefix."""
    hits = []
    for name, value in zip(names, values):
        rest = name.split("__", 1)[-1]
        if rest == column or rest.startswith(column + "_"):
            hits.append({"output": name, "value": float(value)})
    return hits


def one_hot_problems(service: ModelService, column: str, frame, chosen_key: str | None) -> list[str]:
    """Problems with one encoded column's one-hot outputs. chosen_key None means blank: only 'exactly one 1' is checked."""
    names, values = preprocessed_values(service, frame)
    outputs = named_outputs(names, values, column)
    categories = [normalise_code(c) for c in service.encoder_categories[column]]
    problems = []
    if len(outputs) != len(categories):
        problems.append(f"{len(outputs)} one-hot outputs for {len(categories)} encoder categories")
    ones = [index for index, output in enumerate(outputs) if output["value"] == 1.0]
    if len(ones) != 1:
        problems.append(f"expected exactly one output equal to 1, found {len(ones)}")
    elif chosen_key is not None:
        if chosen_key not in categories:
            problems.append(f"option {chosen_key} is not one of the encoder categories")
        elif ones[0] != categories.index(chosen_key):
            problems.append(f"the 1 is on {outputs[ones[0]]['output']}, not on the output for {chosen_key}")
    return problems


def one_hot_section(service: ModelService, frame) -> list[dict]:
    """For the example input: one PASS/FAIL row per one-hot encoded column."""
    rows = []
    for column in service.columns:
        if column not in service.encoder_categories:
            continue
        key = normalise_code(frame.iloc[0][column])
        names, values = preprocessed_values(service, frame)
        ones = [o["output"] for o in named_outputs(names, values, column) if o["value"] == 1.0]
        problems = one_hot_problems(service, column, frame, key)
        rows.append({
            "column": column,
            "chosen": "blank (imputed)" if key is None else key,
            "ones": ones,
            "pass": not problems,
            "problems": problems,
        })
    return rows


def option_problems(service: ModelService, field, option: str, form: dict) -> list[str]:
    """Problems when one dropdown option is chosen and everything else is the example input."""
    try:
        frame, _ = build_frame(service, {**form, field.name: option})
    except ValueError as exc:
        return [f"the form was refused: {exc}"]
    column = field.columns[0]
    value_key = normalise_code(frame.iloc[0][column])
    problems = []
    if value_key != option:
        problems.append(f"the frame holds {frame.iloc[0][column]!r}, not option {option}")
    if column in service.encoder_categories:
        problems += one_hot_problems(service, column, frame, option)
    elif column in OPTIONAL_ENCODING:
        names, values = preprocessed_values(service, frame)
        outputs = named_outputs(names, values, column)
        if len(outputs) != 1 or outputs[0]["value"] != float(option):
            problems.append(f"the pass-through output is {[o['value'] for o in outputs]}, not {option}")
    return problems


def all_options(service: ModelService, form: dict) -> dict:
    """Tries every dropdown option the schema offers, one at a time, with the example input."""
    fields = [field for field in service.fields if field.kind == "select"]
    options_checked = 0
    failures = []
    for field in fields:
        for option, label in service.field_options[field.name]:
            options_checked += 1
            problems = option_problems(service, field, option, form)
            if problems:
                failures.append({"field": field.name, "option": option, "label": label, "problems": problems})
    return {"fields_checked": len(fields), "options_checked": options_checked, "failures": failures}


def timing(service: ModelService, form: dict) -> dict:
    """Times the POST /api/predict path: parse, check, predict. One warm-up call is not counted."""
    def once():
        values, errors = parse_form(form)
        answers, errors, left_blank = service.check_answers(values, errors)
        if errors:
            raise ValueError(errors)
        service.predict(answers, left_blank)

    once()
    samples = []
    for _ in range(TIMING_RUNS):
        start = time.perf_counter()
        once()
        samples.append((time.perf_counter() - start) * 1000)
    return {
        "runs": TIMING_RUNS,
        "median_ms": float(np.median(samples)),
        "p95_ms": float(np.percentile(samples, 95)),
    }


def clean(value):
    """JSON cannot hold NaN, so write it as null."""
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean(item) for item in value]
    return value


def describe(value) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "NaN"
    return str(value)


def collect(service: ModelService, form: dict, trunk) -> dict:
    """Everything the tool reports for one form. trunk is the chosen code (1, 2) or None for blank."""
    chosen_form = {**form, "trunk_road_flag": trunk}
    frame, left_blank = build_frame(service, chosen_form)
    row = frame.iloc[0]

    columns = [
        {"name": column, "value": describe(row[column]), "dtype": str(frame[column].dtype)}
        for column in service.columns
    ]

    names, values = preprocessed_values(service, frame)
    preprocessed = {}
    for column in ("trunk_road_flag", "is_weekend", *VEHICLE_COLUMNS, *PREPROCESSED_SIN_COS, *PREPROCESSED_NUMERIC):
        if column in service.columns:
            preprocessed[column] = named_outputs(names, values, column)

    scenarios = []
    for label, code in (("1", 1), ("2", 2), ("blank", None)):
        scenario_frame, _ = build_frame(service, {**form, "trunk_road_flag": code})
        raw, adjusted, indices = service.score_frame(scenario_frame)
        scenarios.append({
            "trunk": label,
            "trunk_in_frame": describe(scenario_frame.iloc[0]["trunk_road_flag"]),
            "probabilities": {service.class_name(c): round(float(p), 4) for c, p in zip(service.classes, raw[0])},
            "weighted": {service.class_name(c): round(float(p), 4) for c, p in zip(service.classes, adjusted[0])},
            "severity": service.class_name(service.classes[int(indices[0])]),
        })

    checks = []
    value = row["trunk_road_flag"]
    if trunk is None:
        checks.append({"check": "blank trunk sends NaN", "pass": normalise_code(value) is None})
    else:
        checks.append({
            "check": f"trunk value in the frame equals the chosen code {trunk}",
            "pass": normalise_code(value) == str(trunk),
        })
    blank_frame, _ = build_frame(service, {**form, "trunk_road_flag": None})
    checks.append({
        "check": "blank trunk sends NaN (blank scenario)",
        "pass": normalise_code(blank_frame.iloc[0]["trunk_road_flag"]) is None,
    })
    if "has_undocumented_code_33" in service.columns:
        checks.append({
            "check": "has_undocumented_code_33 is 0",
            "pass": float(row["has_undocumented_code_33"]) == 0.0,
        })

    return {
        "model": str(service.model_path),
        "demo": service.demo,
        "warnings": service.warnings,
        "trunk": "blank" if trunk is None else trunk,
        "columns": columns,
        "preprocessed": preprocessed,
        "scenarios": scenarios,
        "checks": checks,
        "left_blank": left_blank,
        "one_hot": one_hot_section(service, frame),
    }


def render(result: dict) -> None:
    print(f"Model: {result['model']}  (demo: {result['demo']})")
    for warning in result["warnings"]:
        print(f"Warning: {warning}")
    print(f"Chosen trunk_road_flag: {result['trunk']}")

    print(f"\n1. The {len(result['columns'])} input columns the app sends (model order)")
    for column in result["columns"]:
        print(f"   {column['name']:<30} {column['value']:<22} {column['dtype']}")

    print("\n2. Preprocessed values (the model's own transform output)")
    for column, outputs in result["preprocessed"].items():
        if not outputs:
            print(f"   {column:<30} (no preprocessed output)")
        for output in outputs:
            print(f"   {column:<30} {output['output']:<40} {output['value']:.6f}")

    print("\n3. Model output for trunk_road_flag = 1, 2 and blank (all else equal)")
    classes = list(result["scenarios"][0]["probabilities"])
    header = "   trunk  " + "  ".join(f"P({c})".ljust(12) for c in classes) + "  " + \
        "  ".join(f"W({c})".ljust(12) for c in classes) + "  severity"
    print(header)
    for scenario in result["scenarios"]:
        probabilities = "  ".join(f"{scenario['probabilities'][c]:<12.4f}" for c in classes)
        weighted = "  ".join(f"{scenario['weighted'][c]:<12.4f}" for c in classes)
        print(f"   {scenario['trunk']:<6} {probabilities}  {weighted}  {scenario['severity']}")
    print("   P = predict_proba, W = Fatal probability times the fatal_adjust weight, then argmax.")

    print("\n4. Checks")
    for check in result["checks"]:
        print(f"   {'PASS' if check['pass'] else 'FAIL'}  {check['check']}")

    print("\n5. One-hot encoded columns for the example input: exactly one output must be 1")
    for row in result["one_hot"]:
        status = "PASS" if row["pass"] else "FAIL"
        ones = ", ".join(f"{name} = 1.0" for name in row["ones"]) or "none"
        print(f"   {status}  {row['column']:<28} chosen {str(row['chosen']):<16} {ones}")
        for problem in row["problems"]:
            print(f"          {problem}")
    print(f"\nLeft blank: {', '.join(result['left_blank']) or 'none'}")


def render_timing(file_mb: float, load_seconds: float, timing_result: dict) -> None:
    print("\n6. Model file and timings")
    print(f"   Model file size: {file_mb:.1f} MB")
    print(f"   Load time (ModelService: joblib.load plus the startup checks): {load_seconds:.2f} s")
    print(f"   {timing_result['runs']} predictions through parse, check and predict: "
          f"median {timing_result['median_ms']:.1f} ms, 95th percentile {timing_result['p95_ms']:.1f} ms")


def render_all_options(result: dict) -> None:
    print("\n7. Every dropdown option in /api/schema, one at a time, with the example input")
    print(f"   Fields checked: {result['fields_checked']}")
    print(f"   Options checked: {result['options_checked']}")
    print(f"   Failures: {len(result['failures'])}")
    for failure in result["failures"]:
        print(f"   FAIL  {failure['field']} option {failure['option']} ({failure['label']})")
        for problem in failure["problems"]:
            print(f"          {problem}")


def parse_trunk(text: str):
    if text.lower() == "blank":
        return None
    if text not in ("1", "2"):
        raise argparse.ArgumentTypeError("--trunk must be 1, 2 or blank")
    return int(text)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--trunk", default="2", help="trunk_road_flag to send: 1, 2 or blank (default 2)")
    parser.add_argument("--all-options", action="store_true", help="try every dropdown option, one at a time")
    parser.add_argument("--json", type=Path, help="also write the results to this file")
    parser.add_argument("--model", type=Path, help="model file to use instead of model_config.json")
    args = parser.parse_args(argv)
    try:
        trunk = parse_trunk(args.trunk)
    except argparse.ArgumentTypeError as exc:
        parser.error(str(exc))

    config = load_model_config()
    model_path = args.model if args.model else resolve_model_path(config)
    start = time.perf_counter()
    service = ModelService(model_path, config, CODE_LABELS_PATH)
    load_seconds = time.perf_counter() - start
    if not service.loaded:
        print(f"Cannot load the model: {service.error}")
        return 1
    try:
        result = collect(service, EXAMPLE_FORM, trunk)
    except ValueError as exc:
        print(f"The example input was refused by validation: {exc}")
        return 1

    file_mb = os.path.getsize(model_path) / 1_000_000
    timing_result = timing(service, {**EXAMPLE_FORM, "trunk_road_flag": trunk})
    result["file_mb"] = file_mb
    result["load_seconds"] = load_seconds
    result["timing"] = timing_result

    render(result)
    render_timing(file_mb, load_seconds, timing_result)

    options_result = None
    if args.all_options:
        options_result = all_options(service, EXAMPLE_FORM)
        result["all_options"] = options_result
        render_all_options(options_result)

    if args.json:
        args.json.write_text(json.dumps(clean(result), indent=2), encoding="utf-8")
        print(f"\nWrote {args.json}")

    failed = (
        any(not check["pass"] for check in result["checks"])
        or any(not row["pass"] for row in result["one_hot"])
        or bool(options_result and options_result["failures"])
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
