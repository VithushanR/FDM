"""tools/show_model_input.py on stand-in models in temp folders."""

import json

import joblib
import pytest

from backend.config import CODE_LABELS_PATH, load_model_config
from backend.services.model_service import ModelService
from tests.conftest import NO_LABELS
from tools import show_model_input
from tools.make_dummy_model import build_pipeline

# The example input uses codes the default stand-in does not know, so this stand-in is trained on them.
EXAMPLE_CODES = {
    "road_type": [1, 2, 3, 6],
    "urban_or_rural_area": [1, 2],
    "junction_detail": [2, 13],
    "light_conditions": [1, 6],
}


@pytest.fixture
def example_pass_through_path(tmp_path):
    path = tmp_path / "example_pass_through.joblib"
    joblib.dump(build_pipeline(pass_through_trunk=True, short_group_names=True,
                               labels_path=NO_LABELS, category_overrides=EXAMPLE_CODES), path)
    return path


@pytest.fixture
def example_categorical_path(tmp_path):
    path = tmp_path / "example_categorical.joblib"
    joblib.dump(build_pipeline(labels_path=NO_LABELS, category_overrides=EXAMPLE_CODES), path)
    return path


def service_for(path):
    service = ModelService(path, load_model_config(), CODE_LABELS_PATH)
    assert service.loaded, service.error
    return service


def test_pass_through_example_passes_every_check(example_pass_through_path):
    result = show_model_input.collect(service_for(example_pass_through_path), show_model_input.EXAMPLE_FORM, 2)
    assert all(check["pass"] for check in result["checks"]), result["checks"]
    assert result["trunk"] == 2


def test_frame_has_one_value_per_model_column_in_model_order(example_pass_through_path):
    service = service_for(example_pass_through_path)
    result = show_model_input.collect(service, show_model_input.EXAMPLE_FORM, 2)
    assert [column["name"] for column in result["columns"]] == service.columns
    values = {column["name"]: column for column in result["columns"]}
    assert values["trunk_road_flag"]["value"] == "2.0"
    assert values["has_undocumented_code_33"]["value"] == "0.0"
    assert values["has_car"]["value"] == "1.0" and values["has_motorcycle"]["value"] == "1.0"


def test_scenarios_cover_trunk_1_2_and_blank(example_pass_through_path):
    result = show_model_input.collect(service_for(example_pass_through_path), show_model_input.EXAMPLE_FORM, 2)
    assert [s["trunk"] for s in result["scenarios"]] == ["1", "2", "blank"]
    assert [s["trunk_in_frame"] for s in result["scenarios"]] == ["1.0", "2.0", "NaN"]
    for scenario in result["scenarios"]:
        assert sum(scenario["probabilities"].values()) == pytest.approx(1.0, abs=0.001)


def test_blank_trunk_is_nan_and_listed_as_left_blank(example_pass_through_path):
    result = show_model_input.collect(service_for(example_pass_through_path), show_model_input.EXAMPLE_FORM, None)
    assert result["trunk"] == "blank"
    assert "Trunk road" in result["left_blank"]
    assert all(check["pass"] for check in result["checks"])


def test_preprocessed_trunk_is_the_pass_through_output(example_pass_through_path):
    result = show_model_input.collect(service_for(example_pass_through_path), show_model_input.EXAMPLE_FORM, 2)
    assert result["preprocessed"]["trunk_road_flag"] == [{"output": "flag__trunk_road_flag", "value": 2.0}]
    assert result["preprocessed"]["month_sin"][0]["output"] == "num__month_sin"


def test_categorical_trunk_model_also_passes(example_categorical_path):
    result = show_model_input.collect(service_for(example_categorical_path), show_model_input.EXAMPLE_FORM, 1)
    assert all(check["pass"] for check in result["checks"]), result["checks"]


def test_main_writes_json_with_null_for_nan_and_returns_zero(example_pass_through_path, tmp_path, capsys):
    out = tmp_path / "out.json"
    code = show_model_input.main(["--model", str(example_pass_through_path), "--trunk", "blank", "--json", str(out)])
    assert code == 0
    body = json.loads(out.read_text(encoding="utf-8"))
    assert body["trunk"] == "blank"
    trunk = next(c for c in body["columns"] if c["name"] == "trunk_road_flag")
    assert trunk["value"] == "NaN"
    assert all(check["pass"] for check in body["checks"])
    assert "1. The 36 input columns" in capsys.readouterr().out


def test_main_rejects_a_trunk_value_other_than_1_2_or_blank():
    with pytest.raises(SystemExit):
        show_model_input.main(["--trunk", "3"])


def test_checks_fail_when_the_trunk_value_does_not_match(example_pass_through_path, monkeypatch):
    service = service_for(example_pass_through_path)
    original = show_model_input.build_frame

    def tampered(service_arg, form):
        frame, left_blank = original(service_arg, form)
        if form.get("trunk_road_flag") == 2:
            frame["trunk_road_flag"] = 1.0  # simulate a wrong value reaching the frame
        return frame, left_blank

    monkeypatch.setattr(show_model_input, "build_frame", tampered)
    result = show_model_input.collect(service, show_model_input.EXAMPLE_FORM, 2)
    trunk_check = next(c for c in result["checks"] if "equals the chosen code" in c["check"])
    assert trunk_check["pass"] is False
