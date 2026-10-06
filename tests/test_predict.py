"""Prediction and validation through the HTTP API, using the stand-in model."""

import json

import joblib
import numpy as np
import pytest
from sklearn.compose import ColumnTransformer
from sklearn.svm import SVC

from backend.schemas.classification import parse_form
from backend.services.features import build_row, normalise_code
from tests.conftest import NO_LABELS, VALID_FORM
from tools.make_dummy_model import build_pipeline


def post(client, **changes):
    body = {**VALID_FORM, **changes}
    body = {key: value for key, value in body.items() if value is not None}
    return client.post("/api/predict", json=body)


def errors_by_field(response) -> dict[str, str]:
    assert response.status_code == 422, response.text
    return {item["field"]: item["message"] for item in response.json()["errors"]}


def column_transformer(pipeline):
    # Found by type, not by step name, because the real pipeline's step names are unknown.
    return next(step for _, step in pipeline.steps if isinstance(step, ColumnTransformer))


def test_valid_input_returns_a_severity(client):
    response = post(client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["severity"] in {"Fatal", "Serious", "Slight"}
    assert body["severity_code"] in {1, 2, 3}
    assert set(body["scores"]) == {"Fatal", "Serious", "Slight"}
    assert set(body["adjusted_scores"]) == {"Fatal", "Serious", "Slight"}
    assert body["score_kind"] == "probability"
    assert sum(body["scores"].values()) == pytest.approx(1.0, abs=0.001)
    assert body["fatal_adjust"] == 1.5
    assert body["adjustment_note"] == (
        "The Fatal probability is multiplied by 1.5 before the result is chosen, "
        "so more Fatal collisions are caught."
    )


def test_empty_form_names_every_required_field(client):
    errors = errors_by_field(client.post("/api/predict", json={}))
    required = {
        "date", "time", "road_type", "speed_limit", "urban_or_rural_area", "junction_detail",
        "light_conditions", "weather_conditions", "road_surface_conditions", "number_of_vehicles", "vehicles",
    }
    assert set(errors) == required
    assert set(errors.values()) == {"This field is required."}


def test_several_bad_values_return_all_their_errors_together(client):
    errors = errors_by_field(post(
        client,
        date="2024-02-30",
        time="25:00",
        speed_limit="45",
        number_of_vehicles=0,
        driver_ages="34, 200",
        latitude=65.0,
    ))
    assert errors == {
        "date": "Enter a valid date.",
        "time": "Enter a valid time, for example 18:30.",
        "speed_limit": "Choose one of the listed options.",
        "number_of_vehicles": "Enter a whole number from 1 to 30.",
        "driver_ages": "Enter driver ages as whole numbers from 1 to 105, separated by commas, for example 34, 52.",
        "latitude": "Enter a number from 49 to 61.",
    }


def test_text_in_a_number_field_is_a_friendly_type_error_alongside_other_errors(client):
    errors = errors_by_field(post(client, number_of_vehicles="many", date="nope"))
    assert errors == {
        "date": "Enter a valid date.",
        "number_of_vehicles": "Enter a whole number.",
    }


def test_boolean_is_not_a_number_of_vehicles(client):
    errors = errors_by_field(post(client, number_of_vehicles=True))
    assert errors == {"number_of_vehicles": "Enter a whole number."}


def test_blank_optional_fields_are_listed_in_left_blank(client):
    response = post(client, driver_ages="", latitude=None, longitude=None)
    assert response.status_code == 200, response.text
    left_blank = response.json()["left_blank"]
    assert {"Driver ages", "Latitude", "Longitude", "Road class"} <= set(left_blank)
    assert "Date" not in left_blank and "Road layout" not in left_blank  # required fields are never blank here


def test_age_under_ten_is_allowed_only_with_a_pedal_cycle(client):
    assert post(client, driver_ages="9", vehicles=["pedal_cycle"], number_of_vehicles=1).status_code == 200
    errors = errors_by_field(post(client, driver_ages="9", vehicles=["car"], number_of_vehicles=2))
    assert errors == {"driver_ages": "Ages under 10 are only allowed when a pedal cycle is involved."}


def test_vehicle_count_must_cover_the_ticked_types(client):
    errors = errors_by_field(post(client, number_of_vehicles=1, vehicles=["car", "pedal_cycle"], driver_ages=""))
    assert errors == {"number_of_vehicles": "You ticked 2 vehicle types, so there must be at least 2 vehicles."}


def test_driver_ages_cannot_outnumber_vehicles(client):
    errors = errors_by_field(post(client, number_of_vehicles=1, vehicles=["car"], driver_ages="30, 40"))
    assert set(errors) == {"driver_ages"}


def test_latitude_and_longitude_must_come_together(client):
    # The error goes on the blank one, so the user sees which half is missing.
    errors = errors_by_field(post(client, longitude=None))
    assert errors == {"longitude": "Enter latitude and longitude together, or leave both blank."}
    errors = errors_by_field(post(client, latitude=None))
    assert errors == {"latitude": "Enter latitude and longitude together, or leave both blank."}


def test_coordinates_outside_the_uk_are_refused(client):
    errors = errors_by_field(post(client, latitude=40.0, longitude=-0.1))
    assert errors == {"latitude": "Enter a number from 49 to 61."}


def test_a_chosen_dropdown_value_switches_on_its_one_hot_column(client):
    service = client.app.state.model
    values, parse_errors = parse_form({**VALID_FORM, "road_type": 4})
    answers, errors, _ = service.check_answers(values, parse_errors)
    assert errors == {}
    frame = service.to_frame([build_row(answers)])
    preprocessor = column_transformer(service.pipeline)
    transformed = preprocessor.transform(frame)[0]
    names = list(preprocessor.get_feature_names_out())
    road = {name: transformed[index] for index, name in enumerate(names) if name.startswith("cat__road_type_")}
    assert road["cat__road_type_4"] == 1.0
    assert sum(road.values()) == 1.0


def test_unseen_category_becomes_all_zeros_not_an_error(client):
    service = client.app.state.model
    frame = service.to_frame([build_row({"date": None, "time": None, "road_type": "99"})])
    preprocessor = column_transformer(service.pipeline)
    transformed = preprocessor.transform(frame)[0]
    names = list(preprocessor.get_feature_names_out())
    road = [transformed[index] for index, name in enumerate(names) if name.startswith("cat__road_type_")]
    assert road and all(value == 0.0 for value in road)


def test_fatal_adjust_very_large_always_returns_fatal(make_client, dummy_model_path, write_config):
    config_path = write_config(fatal_adjust=1e9)
    with make_client(dummy_model_path, config_path=config_path) as client:
        for day in range(1, 8):
            response = post(client, date=f"2024-03-{day:02d}")
            assert response.json()["severity"] == "Fatal"


def test_fatal_adjust_zero_never_returns_fatal(make_client, dummy_model_path, write_config):
    config_path = write_config(fatal_adjust=0)
    with make_client(dummy_model_path, config_path=config_path) as client:
        for day in range(1, 8):
            response = post(client, date=f"2024-03-{day:02d}", number_of_vehicles=1, vehicles=["car"], driver_ages="")
            assert response.json()["severity"] != "Fatal"


def test_svm_style_decision_function_with_add_adjustment(make_client, tmp_path, write_config):
    model_path = tmp_path / "dummy_svm_pipeline.joblib"
    joblib.dump(build_pipeline(classifier=SVC(kernel="linear", decision_function_shape="ovr"), labels_path=NO_LABELS), model_path)
    config_path = write_config(score_method="decision_function", adjust_mode="add", fatal_adjust=0.5)
    with make_client(model_path, config_path=config_path) as client:
        schema = client.get("/api/schema").json()
        assert schema["score_kind"] == "score"
        assert schema["adjust_mode"] == "add"
        result = post(client).json()
        assert result["score_kind"] == "score"
        assert result["adjusted_scores"]["Fatal"] == pytest.approx(result["scores"]["Fatal"] + 0.5, abs=0.0002)
        assert result["adjusted_scores"]["Serious"] == result["scores"]["Serious"]
        assert result["adjustment_note"].startswith("The Fatal score has 0.5 added to it")


def test_normalise_code_treats_the_same_value_the_same_way():
    for value in (6, 6.0, np.int64(6), "6", " 6.0 ", np.float64(6.0)):
        assert normalise_code(value) == "6"
    assert normalise_code(None) is None
    assert normalise_code(float("nan")) is None
    assert normalise_code("Night") == "Night"


def test_predict_body_must_be_an_object(client):
    response = client.post("/api/predict", content=json.dumps([1, 2]), headers={"content-type": "application/json"})
    assert errors_by_field(response) == {"body": "Send the form as a JSON object."}
