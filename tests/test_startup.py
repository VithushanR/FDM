"""Startup self-checks, the schema, and the form options. The app must start even when the model is bad."""

import json

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from backend.config import load_model_config
from backend.services.model_service import ModelService
from tests.conftest import VALID_FORM
from tools.make_dummy_model import build_pipeline


def make_numeric_model(path, columns):
    rng = np.random.default_rng(0)
    frame = pd.DataFrame(rng.normal(size=(60, len(columns))), columns=columns)
    y = rng.choice([1, 2, 3], 60)
    pipeline = Pipeline([
        ("preprocessor", ColumnTransformer([("numeric", StandardScaler(), columns)])),
        ("classifier", RandomForestClassifier(n_estimators=5, random_state=0)),
    ]).fit(frame, y)
    joblib.dump(pipeline, path)
    return path


def test_missing_model_gives_503_everywhere_and_the_app_still_starts(make_client, tmp_path):
    with make_client(tmp_path / "rf_classifier_pipeline.joblib") as client:
        health = client.get("/api/health")
        assert health.status_code == 503
        assert health.json()["status"] == "error"
        assert "Copy rf_classifier_pipeline.joblib into models/ or set MODEL_PATH." in health.json()["error"]
        schema = client.get("/api/schema")
        assert schema.status_code == 503 and schema.json()["loaded"] is False
        predict = client.post("/api/predict", json=VALID_FORM)
        assert predict.status_code == 503 and predict.json()["loaded"] is False


def test_model_expecting_a_leakage_column_is_refused_and_named(make_client, tmp_path):
    path = make_numeric_model(tmp_path / "leaky.joblib", ["speed_limit", "worst_casualty_severity"])
    with make_client(path) as client:
        response = client.get("/api/health")
        assert response.status_code == 503
        assert "worst_casualty_severity" in response.json()["error"]


def test_casualty_flag_columns_count_as_leakage(make_client, tmp_path):
    path = make_numeric_model(tmp_path / "leaky2.joblib", ["speed_limit", "has_car_casualty"])
    with make_client(path) as client:
        assert "has_car_casualty" in client.get("/api/health").json()["error"]


def test_model_expecting_an_unknown_column_is_refused_and_named(make_client, tmp_path):
    path = make_numeric_model(tmp_path / "unknown.joblib", ["speed_limit", "mystery_column"])
    with make_client(path) as client:
        assert "mystery_column" in client.get("/api/schema").json()["error"]


def test_inconsistent_version_gives_one_warning(make_client, tmp_path, monkeypatch):
    import sklearn.base
    monkeypatch.setattr(sklearn.base, "__version__", "1.0.0")
    path = tmp_path / "old_version.joblib"
    joblib.dump(build_pipeline(), path)
    monkeypatch.undo()
    with make_client(path) as client:
        warnings = client.get("/api/health").json()["warnings"]
        version_warnings = [w for w in warnings if "scikit-learn" in w]
        assert len(version_warnings) == 1
        assert "saved with scikit-learn 1.0.0" in version_warnings[0]


def test_unknown_season_values_in_the_encoder_are_warned(make_client, tmp_path):
    path = tmp_path / "three_seasons.joblib"
    joblib.dump(build_pipeline(category_overrides={"season": ["Winter", "Spring", "Summer"]}), path)
    with make_client(path) as client:
        warnings = client.get("/api/health").json()["warnings"]
        assert any("does not know Autumn" in w for w in warnings)


def test_standard_stand_in_model_has_no_encoder_warnings(client):
    warnings = client.get("/api/health").json()["warnings"]
    assert not any("does not know" in w for w in warnings)


def test_trunk_road_is_a_dropdown_from_the_encoder_like_other_categories(client):
    schema = client.get("/api/schema").json()
    trunk = next(f for g in schema["groups"] for f in g["fields"] if f["name"] == "trunk_road_flag")
    assert trunk["label"] == "Trunk road"
    assert not trunk["required"]
    assert [option["value"] for option in trunk["options"]] == ["1", "2", "3", "4", "5"]


def test_trunk_road_choice_reaches_the_model_as_its_one_hot_column(client):
    from sklearn.compose import ColumnTransformer

    from backend.schemas.classification import parse_form
    from backend.services.features import build_row

    service = client.app.state.model
    values, parse_errors = parse_form({**VALID_FORM, "trunk_road_flag": 2})
    answers, errors, _ = service.check_answers(values, parse_errors)
    assert errors == {}
    frame = service.to_frame([build_row(answers)])
    preprocessor = next(step for _, step in service.pipeline.steps if isinstance(step, ColumnTransformer))
    names = list(preprocessor.get_feature_names_out())
    transformed = preprocessor.transform(frame)[0]
    trunk = {name: transformed[i] for i, name in enumerate(names) if name.startswith("cat__trunk_road_flag_")}
    assert trunk["cat__trunk_road_flag_2"] == 1.0
    assert sum(trunk.values()) == 1.0


def test_trunk_road_sentinel_minus_one_is_not_an_option(tmp_path):
    path = tmp_path / "trunk.joblib"
    joblib.dump(build_pipeline(category_overrides={"trunk_road_flag": [-1, 1, 2]}), path)
    service = ModelService(path, load_model_config(), tmp_path / "missing_labels.json")
    assert service.loaded, service.error
    assert [value for value, _ in service.field_options["trunk_road_flag"]] == ["1", "2"]


def test_precollision_model_hides_vehicle_driver_and_location_fields_but_still_predicts(
    make_client, precollision_model_path,
):
    with make_client(precollision_model_path) as client:
        schema = client.get("/api/schema").json()
        names = {field["name"] for group in schema["groups"] for field in group["fields"]}
        assert not names & {"vehicles", "driver_ages", "number_of_vehicles", "latitude", "longitude"}
        assert {"date", "time", "road_type", "speed_limit"} <= names
        form = {key: value for key, value in VALID_FORM.items()
                if key not in {"vehicles", "driver_ages", "number_of_vehicles", "latitude", "longitude"}}
        response = client.post("/api/predict", json=form)
        assert response.status_code == 200, response.text
        hidden_labels = {"Types of vehicle involved", "Driver ages", "Number of vehicles", "Latitude", "Longitude"}
        assert not set(response.json()["left_blank"]) & hidden_labels


def test_schema_is_json_serialisable(client):
    schema = client.get("/api/schema")
    assert schema.status_code == 200
    json.dumps(schema.json())
    json.dumps(client.app.state.model.schema())


def test_speed_limit_options_are_shown_in_mph(client):
    schema = client.get("/api/schema").json()
    speed = next(f for g in schema["groups"] for f in g["fields"] if f["name"] == "speed_limit")
    assert [option["label"] for option in speed["options"]] == [
        "20 mph", "30 mph", "40 mph", "50 mph", "60 mph", "70 mph",
    ]


def test_category_options_come_from_the_encoder_sorted_numerically_without_the_sentinel(
    tmp_path, write_config,
):
    path = tmp_path / "road_types.joblib"
    joblib.dump(build_pipeline(category_overrides={"road_type": [10, -1, 2, 1]}), path)
    labels_path = tmp_path / "code_labels.json"
    labels_path.write_text(json.dumps({"road_type": {"2": "Two-way road", "10": "Ten"}}), encoding="utf-8")
    service = ModelService(path, load_model_config(), labels_path)
    assert service.loaded, service.error
    road_options = service.field_options["road_type"]
    assert road_options == [("1", "Code 1"), ("2", "Two-way road"), ("10", "Ten")]


def test_missing_labels_file_is_a_warning_not_an_error(tmp_path):
    path = tmp_path / "stand_in.joblib"
    joblib.dump(build_pipeline(), path)
    service = ModelService(path, load_model_config(), tmp_path / "code_labels.json")
    assert service.loaded, service.error
    assert any("code_labels.json was not found" in w for w in service.warnings)
    assert ("1", "Code 1") in service.field_options["road_type"]


def test_cors_is_off_by_default_and_on_when_configured(make_client, dummy_model_path, monkeypatch):
    preflight = {"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"}
    with make_client(dummy_model_path) as client:
        assert "access-control-allow-origin" not in client.options("/api/predict", headers=preflight).headers
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173, https://example.org")
    with make_client(dummy_model_path) as client:
        response = client.options("/api/predict", headers=preflight)
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_file_that_is_not_a_pipeline_gives_503_and_the_app_still_starts(make_client, tmp_path):
    path = tmp_path / "not_a_model.joblib"
    joblib.dump({"just": "a dict"}, path)
    with make_client(path) as client:
        assert client.get("/api/health").status_code == 503
        assert "Expected a scikit-learn Pipeline" in client.get("/api/health").json()["error"]


def test_pipeline_without_classes_gives_503_and_the_app_still_starts(make_client, tmp_path):
    from sklearn.preprocessing import StandardScaler

    columns = ["speed_limit", "number_of_vehicles"]
    frame = pd.DataFrame(np.random.default_rng(0).normal(size=(20, 2)), columns=columns)
    pipeline = Pipeline([
        ("preprocessor", ColumnTransformer([("numeric", StandardScaler(), columns)])),
        ("scaler", StandardScaler()),
    ]).fit(frame)
    path = tmp_path / "no_classes.joblib"
    joblib.dump(pipeline, path)
    with make_client(path) as client:
        response = client.get("/api/health")
        assert response.status_code == 503
        assert "could not be checked" in response.json()["error"]
