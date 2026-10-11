"""POST /api/explain: contributing factors for a single prediction, using the stand-in model."""

import json

from tests.conftest import VALID_FORM


def post(client, **changes):
    body = {**VALID_FORM, **changes}
    body = {key: value for key, value in body.items() if value is not None}
    return client.post("/api/explain", json=body)


def errors_by_field(response) -> dict[str, str]:
    assert response.status_code == 422, response.text
    return {item["field"]: item["message"] for item in response.json()["errors"]}


def test_valid_input_returns_a_factor_per_answer_given(client):
    response = post(client)
    assert response.status_code == 200, response.text
    factors = response.json()["factors"]
    assert factors
    fields = {factor["field"] for factor in factors}
    # driver_ages = "34, 9" and vehicles = ["car", "pedal_cycle"] in VALID_FORM.
    assert "vehicles" in fields
    assert "latitude" not in fields and "longitude" not in fields
    for factor in factors:
        assert isinstance(factor["label"], str) and factor["label"]
        assert isinstance(factor["points"], (int, float))


def test_each_ticked_vehicle_type_is_its_own_factor(client):
    response = post(client, vehicles=["car", "pedal_cycle"], number_of_vehicles=2)
    assert response.status_code == 200, response.text
    labels = {factor["label"] for factor in response.json()["factors"] if factor["field"] == "vehicles"}
    assert labels == {"Car or taxi involved", "Pedal cycle involved"}


def test_blank_optional_fields_are_never_listed(client):
    response = post(client, driver_ages="", latitude=None, longitude=None, first_road_class=None)
    assert response.status_code == 200, response.text
    fields = {factor["field"] for factor in response.json()["factors"]}
    assert "driver_ages" not in fields
    assert "first_road_class" not in fields


def test_invalid_input_is_rejected_the_same_way_as_predict(client):
    errors = errors_by_field(post(client, date="2024-02-30"))
    assert errors == {"date": "Enter a valid date."}


def test_empty_body_names_every_required_field(client):
    errors = errors_by_field(client.post("/api/explain", json={}))
    required = {
        "date", "time", "road_type", "speed_limit", "urban_or_rural_area", "junction_detail",
        "light_conditions", "weather_conditions", "road_surface_conditions", "number_of_vehicles", "vehicles",
    }
    assert set(errors) == required


def test_explain_body_must_be_an_object(client):
    response = client.post("/api/explain", content=json.dumps([1, 2]), headers={"content-type": "application/json"})
    assert errors_by_field(response) == {"body": "Send the form as a JSON object."}
