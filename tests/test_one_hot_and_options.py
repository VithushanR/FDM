"""One-hot checks, --all-options, and timings in tools/show_model_input.py, on stand-ins in temp folders."""

import json

import joblib
import pytest

from backend.config import CODE_LABELS_PATH, load_model_config
from backend.services.model_service import ModelService
from tests.conftest import NO_LABELS
from tools import show_model_input
from tools.make_dummy_model import build_pipeline

EXAMPLE_CODES = {
    "road_type": [1, 2, 3, 6],
    "urban_or_rural_area": [1, 2],
    "junction_detail": [2, 13],
    "light_conditions": [1, 6],
}


@pytest.fixture
def pass_through_path(tmp_path):
    path = tmp_path / "pass_through.joblib"
    joblib.dump(build_pipeline(pass_through_trunk=True, short_group_names=True,
                               labels_path=NO_LABELS, category_overrides=EXAMPLE_CODES), path)
    return path


@pytest.fixture
def categorical_path(tmp_path):
    path = tmp_path / "categorical.joblib"
    joblib.dump(build_pipeline(labels_path=NO_LABELS, category_overrides=EXAMPLE_CODES), path)
    return path


def service_for(path):
    service = ModelService(path, load_model_config(), CODE_LABELS_PATH)
    assert service.loaded, service.error
    return service


@pytest.mark.parametrize("fixture_name", ["pass_through_path", "categorical_path"])
def test_every_encoded_column_has_exactly_one_one_on_the_chosen_output(request, fixture_name):
    service = service_for(request.getfixturevalue(fixture_name))
    result = show_model_input.collect(service, show_model_input.EXAMPLE_FORM, 2)
    rows = {row["column"]: row for row in result["one_hot"]}
    assert set(rows) == set(service.encoder_categories)
    assert all(row["pass"] for row in rows.values()), [row for row in rows.values() if not row["pass"]]
    assert all(len(row["ones"]) == 1 for row in rows.values())


@pytest.mark.parametrize("fixture_name", ["pass_through_path", "categorical_path"])
def test_all_options_pass_on_the_stand_in(request, fixture_name):
    service = service_for(request.getfixturevalue(fixture_name))
    result = show_model_input.all_options(service, show_model_input.EXAMPLE_FORM)
    select_fields = [f for f in service.fields if f.kind == "select"]
    assert result["fields_checked"] == len(select_fields)
    assert result["options_checked"] == sum(len(service.field_options[f.name]) for f in select_fields)
    assert result["failures"] == []


def test_a_deliberately_broken_option_is_reported(pass_through_path):
    service = service_for(pass_through_path)
    # Break one option: the mapping sends option "6" to the category for "1".
    service.category_lookup["road_type"]["6"] = service.category_lookup["road_type"]["1"]
    result = show_model_input.all_options(service, show_model_input.EXAMPLE_FORM)
    assert result["failures"], "the broken option should be reported"
    assert {(f["field"], f["option"]) for f in result["failures"]} == {("road_type", "6")}
    problems = result["failures"][0]["problems"]
    assert any("the frame holds" in p for p in problems)
    assert any("not on the output for 6" in p for p in problems)


def test_main_all_options_exits_zero_on_a_good_model(pass_through_path, capsys):
    code = show_model_input.main(["--model", str(pass_through_path), "--all-options"])
    assert code == 0
    out = capsys.readouterr().out
    assert "7. Every dropdown option" in out
    assert "Failures: 0" in out


def test_main_exits_non_zero_when_an_option_fails(pass_through_path, monkeypatch, capsys):
    real = show_model_input.option_problems

    def failing_for_road_type(service, field, option, form):
        if field.name == "road_type" and option == "6":
            return ["forced failure for the test"]
        return real(service, field, option, form)

    monkeypatch.setattr(show_model_input, "option_problems", failing_for_road_type)
    code = show_model_input.main(["--model", str(pass_through_path), "--all-options"])
    assert code == 1
    assert "FAIL  road_type option 6" in capsys.readouterr().out


def test_one_hot_failure_makes_main_exit_non_zero(pass_through_path, monkeypatch):
    def broken(service, column, frame, chosen_key):
        return ["forced one-hot failure"] if column == "road_type" else []

    monkeypatch.setattr(show_model_input, "one_hot_problems", broken)
    assert show_model_input.main(["--model", str(pass_through_path)]) == 1


def test_timing_reports_median_and_95th_percentile(pass_through_path):
    service = service_for(pass_through_path)
    result = show_model_input.timing(service, {**show_model_input.EXAMPLE_FORM, "trunk_road_flag": 2})
    assert result["runs"] == show_model_input.TIMING_RUNS
    assert 0 < result["median_ms"] <= result["p95_ms"]


def test_json_output_includes_the_new_sections(pass_through_path, tmp_path):
    out = tmp_path / "result.json"
    show_model_input.main(["--model", str(pass_through_path), "--all-options", "--json", str(out)])
    body = json.loads(out.read_text(encoding="utf-8"))
    assert {"one_hot", "timing", "all_options", "file_mb", "load_seconds"} <= set(body)
    assert body["all_options"]["failures"] == []
    assert body["timing"]["runs"] == show_model_input.TIMING_RUNS
