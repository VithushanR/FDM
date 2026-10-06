"""POST /api/location/check, the location part of POST /api/predict, /api/health, /api/about, and the Location widget."""

import json

import numpy as np
import pytest

from backend.config import ABOUT_PATH
from backend.services.coverage_service import EARTH_RADIUS_KM, FALLBACK_WARNING, OUTSIDE_MESSAGE
from tests.conftest import VALID_FORM

HERE = (VALID_FORM["latitude"], VALID_FORM["longitude"])
OUTSIDE_TEXT = OUTSIDE_MESSAGE.format(km=10)


def point_north(km: float) -> tuple[float, float]:
    return HERE[0] + km / (EARTH_RADIUS_KM * np.pi / 180), HERE[1]


@pytest.fixture
def grid(tmp_path):
    """A one-cell grid centred on the example location, so that location is covered."""
    path = tmp_path / "grid.npz"
    np.savez(path, centre_latitude=np.array([HERE[0]], dtype=np.float32),
             centre_longitude=np.array([HERE[1]], dtype=np.float32), cell_degrees=np.float64(0.01))
    return path


@pytest.fixture
def located(make_client, dummy_model_path, grid):
    with make_client(dummy_model_path, coverage_path=grid) as client:
        yield client


def form_at(lat: float, lon: float, **changes) -> dict:
    return {**VALID_FORM, "latitude": lat, "longitude": lon, **changes}


def test_location_check_covered_sparse_and_outside(located):
    covered = located.post("/api/location/check", json={"latitude": HERE[0], "longitude": HERE[1]})
    assert covered.status_code == 200
    assert covered.json()["status"] == "covered" and covered.json()["allowed"] is True
    assert covered.json()["message"] is None

    sparse = located.post("/api/location/check", json=dict(zip(("latitude", "longitude"), point_north(5))))
    assert sparse.json()["status"] == "sparse" and sparse.json()["allowed"] is True
    assert sparse.json()["message"].startswith("There is little recorded collision data near this location")

    outside = located.post("/api/location/check", json=dict(zip(("latitude", "longitude"), point_north(20))))
    assert outside.json()["status"] == "outside" and outside.json()["allowed"] is False
    assert outside.json()["message"] == OUTSIDE_TEXT
    assert set(outside.json()) == {"status", "nearest_km", "message", "allowed"}


def test_location_check_invalid_input_is_a_422_in_the_errors_shape(located):
    missing = located.post("/api/location/check", json={"latitude": 51.5})
    assert missing.status_code == 422
    assert missing.json() == {"errors": [{"field": "longitude", "message": "This field is required."}]}

    out_of_box = located.post("/api/location/check", json={"latitude": 40.0, "longitude": -0.1})
    assert out_of_box.json() == {"errors": [{"field": "latitude", "message": "Enter a number from 49 to 61."}]}

    text = located.post("/api/location/check", json={"latitude": "north", "longitude": -0.1})
    assert text.json() == {"errors": [{"field": "latitude", "message": "Enter a number."}]}

    not_object = located.post("/api/location/check", json=[1, 2])
    assert not_object.json() == {"errors": [{"field": "body", "message": "Send the location as a JSON object."}]}


def test_health_reports_the_grid(located):
    body = located.get("/api/health").json()
    assert body["coverage_grid"] == "loaded (1 cells)"
    assert FALLBACK_WARNING not in body["warnings"]


def test_health_warns_when_the_grid_is_missing(make_client, dummy_model_path):
    with make_client(dummy_model_path) as client:
        body = client.get("/api/health").json()
        assert body["coverage_grid"] == "missing"
        assert FALLBACK_WARNING in body["warnings"]


def test_predict_outside_point_is_a_422_on_latitude_together_with_other_errors(located):
    lat, lon = point_north(20)
    response = located.post("/api/predict", json=form_at(lat, lon, number_of_vehicles=0))
    assert response.status_code == 422
    errors = {item["field"]: item["message"] for item in response.json()["errors"]}
    assert errors["latitude"] == OUTSIDE_TEXT
    assert errors["number_of_vehicles"] == "Enter a whole number from 1 to 30."


def test_predict_outside_point_alone_is_a_422_on_latitude(located):
    lat, lon = point_north(20)
    response = located.post("/api/predict", json=form_at(lat, lon))
    assert response.status_code == 422
    assert response.json() == {"errors": [{"field": "latitude", "message": OUTSIDE_TEXT}]}


def test_predict_sparse_point_is_a_200_with_a_warning(located):
    lat, lon = point_north(5)
    response = located.post("/api/predict", json=form_at(lat, lon))
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["warnings"]) == 1 and body["warnings"][0].startswith("There is little recorded collision data")
    assert body["location"]["status"] == "sparse"
    assert body["location"]["nearest_km"] == pytest.approx(5.0, abs=0.05)


def test_predict_covered_point_has_no_warnings(located):
    response = located.post("/api/predict", json=VALID_FORM)
    body = response.json()
    assert response.status_code == 200
    assert body["warnings"] == []
    assert body["location"]["status"] == "covered"


def test_predict_without_a_location_has_empty_warnings_and_null_location(located):
    form = {key: value for key, value in VALID_FORM.items() if key not in ("latitude", "longitude")}
    body = located.post("/api/predict", json=form).json()
    assert body["warnings"] == []
    assert body["location"] is None
    assert "Latitude" in body["left_blank"] and "Longitude" in body["left_blank"]


def test_predict_without_a_grid_reports_unchecked(make_client, dummy_model_path):
    with make_client(dummy_model_path) as client:
        body = client.post("/api/predict", json=VALID_FORM).json()
        assert body["location"] == {"status": "unchecked", "nearest_km": None}
        assert body["warnings"] == []


def test_location_widget_is_on_the_location_group_only(located):
    schema = located.get("/api/schema").json()
    widgets = {group["title"]: group["widget"] for group in schema["groups"]}
    assert widgets["Location"] == "location"
    assert widgets["When"] is None
    location = next(g for g in schema["groups"] if g["title"] == "Location")
    assert [f["name"] for f in location["fields"]] == ["latitude", "longitude"]


def test_about_returns_the_confusion_matrix_and_the_sums_match(located):
    body = located.get("/api/about").json()
    matrix = body["test_results"]["confusion_matrix_rows_true_columns_predicted"]
    supports = [body["test_results"]["per_class"][name]["support"] for name in body["test_results"]["classes"]]
    assert [sum(row) for row in matrix] == supports
    assert matrix[0] == [455, 438, 240]
    assert body["data"]["collisions"] == 513801


def test_about_matches_the_shipped_file(located):
    assert located.get("/api/about").json() == json.loads(ABOUT_PATH.read_text(encoding="utf-8"))


def test_a_corrupted_about_file_gives_503_naming_the_problem(make_client, dummy_model_path, tmp_path):
    data = json.loads(ABOUT_PATH.read_text(encoding="utf-8"))
    data["test_results"]["confusion_matrix_rows_true_columns_predicted"][0][0] = 456
    bad = tmp_path / "about.json"
    bad.write_text(json.dumps(data), encoding="utf-8")
    with make_client(dummy_model_path, about_path=bad) as client:
        response = client.get("/api/about")
        assert response.status_code == 503
        assert response.json()["available"] is False
        assert "row for Fatal sums to 1134, but its support is 1133" in response.json()["message"]


def test_a_missing_about_file_gives_503(make_client, dummy_model_path, tmp_path):
    with make_client(dummy_model_path, about_path=tmp_path / "absent.json") as client:
        response = client.get("/api/about")
        assert response.status_code == 503
        assert "absent.json was not found" in response.json()["message"]
        assert client.get("/api/health").status_code == 200  # the rest of the app still starts
