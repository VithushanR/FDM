"""trunk_road_flag as a pass-through number or a category, decided at load, and the real model's group names."""

import joblib
import numpy as np
import pytest
from sklearn.compose import ColumnTransformer

from tests.conftest import NO_LABELS, VALID_FORM
from tools.make_dummy_model import build_pipeline


@pytest.fixture
def pass_through_model_path(tmp_path):
    path = tmp_path / "pass_through.joblib"
    joblib.dump(build_pipeline(pass_through_trunk=True, short_group_names=True, labels_path=NO_LABELS), path)
    return path


def trunk_field(schema):
    return next(f for g in schema["groups"] for f in g["fields"] if f["name"] == "trunk_road_flag")


def capture_frames(client):
    service = client.app.state.model
    seen = []
    original = service.score_frame

    def spy(frame):
        seen.append(frame)
        return original(frame)

    service.score_frame = spy
    return seen


def test_pass_through_model_loads_with_real_group_names(make_client, pass_through_model_path):
    with make_client(pass_through_model_path) as client:
        health = client.get("/api/health")
        assert health.status_code == 200, health.text
        assert not any("trunk" in w for w in health.json()["warnings"])


def test_pass_through_model_uses_the_real_group_names(pass_through_model_path):
    pipeline = joblib.load(pass_through_model_path)
    preprocessor = next(step for _, step in pipeline.steps if isinstance(step, ColumnTransformer))
    assert [name for name, _, _ in preprocessor.transformers_] == ["num", "cat", "flag"]


def test_pass_through_trunk_field_is_shown_with_flag_options(make_client, pass_through_model_path):
    with make_client(pass_through_model_path) as client:
        field = trunk_field(client.get("/api/schema").json())
        assert field["label"] == "Trunk road"
        assert field["options"] == [
            {"value": "1", "label": "Trunk road"},
            {"value": "2", "label": "Non-trunk road"},
        ]


@pytest.mark.parametrize("chosen, sent", [(1, 1.0), (2, 2.0), ("2", 2.0)])
def test_pass_through_codes_reach_the_model_unchanged(make_client, pass_through_model_path, chosen, sent):
    with make_client(pass_through_model_path) as client:
        frames = capture_frames(client)
        response = client.post("/api/predict", json={**VALID_FORM, "trunk_road_flag": chosen})
        assert response.status_code == 200, response.text
        assert frames[-1]["trunk_road_flag"].iloc[0] == sent


def test_blank_pass_through_trunk_sends_nan_and_is_listed_as_blank(make_client, pass_through_model_path):
    with make_client(pass_through_model_path) as client:
        frames = capture_frames(client)
        response = client.post("/api/predict", json=VALID_FORM)
        assert response.status_code == 200, response.text
        assert np.isnan(frames[-1]["trunk_road_flag"].iloc[0])
        assert "Trunk road" in response.json()["left_blank"]


def test_pass_through_trunk_with_a_code_outside_the_options_is_refused(make_client, pass_through_model_path):
    with make_client(pass_through_model_path) as client:
        response = client.post("/api/predict", json={**VALID_FORM, "trunk_road_flag": 3})
        assert response.status_code == 422
        assert response.json() == {"errors": [{"field": "trunk_road_flag", "message": "Choose one of the listed options."}]}


def test_pass_through_trunk_without_flag_options_is_warned_not_hidden(make_client, pass_through_model_path, write_config):
    config_path = write_config(flag_options={})
    with make_client(pass_through_model_path, config_path=config_path) as client:
        schema = client.get("/api/schema").json()
        field = trunk_field(schema)
        assert field["options"] == []
        assert any("trunk_road_flag is passed through as a number" in w for w in schema["warnings"])
        assert client.get("/api/health").status_code == 200


def test_categorical_trunk_model_keeps_the_encoder_dropdown(make_client, dummy_model_path):
    # The stand-in encodes trunk_road_flag, so the encoder's codes are used, not flag_options.
    with make_client(dummy_model_path) as client:
        field = trunk_field(client.get("/api/schema").json())
        assert [option["value"] for option in field["options"]] == ["1", "2", "3", "4", "5"]
