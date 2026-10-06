"""Hotspot endpoints and the hotspot file contract."""

import copy
import json

import pytest

from tools.make_sample_hotspots import SLICES, SUBSETS, build_sample

UNAVAILABLE = {"available": False, "message": "Hotspot analysis has not been generated yet."}


@pytest.fixture
def sample_path(tmp_path):
    path = tmp_path / "hotspots.json"
    path.write_text(json.dumps(build_sample()), encoding="utf-8")
    return path


def test_missing_file_gives_503_on_both_endpoints(client):
    for url in ("/api/hotspots", "/api/hotspots/meta"):
        response = client.get(url)
        assert response.status_code == 503
        assert response.json() == UNAVAILABLE


def test_sample_file_is_filtered_and_sorted_by_collisions(make_client, dummy_model_path, sample_path):
    with make_client(dummy_model_path, hotspot_path=sample_path) as client:
        body = client.get("/api/hotspots", params={
            "subset": "severe", "slice": "Evening Rush", "min_collisions": 1, "limit": 200,
        }).json()
        assert body["subset"] == "severe" and body["slice"] == "Evening Rush"
        assert body["count"] == len(body["hotspots"]) == 4
        assert all(h["subset"] == "severe" and h["slice"] == "Evening Rush" for h in body["hotspots"])
        collisions = [h["collisions"] for h in body["hotspots"]]
        assert collisions == sorted(collisions, reverse=True)


def test_min_collisions_and_limit_are_applied(make_client, dummy_model_path, sample_path):
    with make_client(dummy_model_path, hotspot_path=sample_path) as client:
        everything = client.get("/api/hotspots", params={"subset": "all", "slice": "All times"}).json()
        top = client.get("/api/hotspots", params={"subset": "all", "slice": "All times", "limit": 2}).json()
        assert top["count"] == 2
        assert top["hotspots"] == everything["hotspots"][:2]
        high = client.get("/api/hotspots", params={"min_collisions": 10_000}).json()
        assert high["count"] == 0


def test_defaults_are_all_subset_and_all_times(make_client, dummy_model_path, sample_path):
    with make_client(dummy_model_path, hotspot_path=sample_path) as client:
        body = client.get("/api/hotspots").json()
        assert body["subset"] == "all" and body["slice"] == "All times"


def test_meta_describes_the_file(make_client, dummy_model_path, sample_path):
    with make_client(dummy_model_path, hotspot_path=sample_path) as client:
        meta = client.get("/api/hotspots/meta").json()
        assert meta["method"].startswith("SAMPLE")
        assert meta["subsets"] == SUBSETS
        assert meta["slices"] == SLICES
        assert meta["total_hotspots"] == len(SUBSETS) * len(SLICES) * 4
        json.dumps(meta)


def test_unknown_subset_is_a_422_with_the_errors_shape(make_client, dummy_model_path, sample_path):
    with make_client(dummy_model_path, hotspot_path=sample_path) as client:
        response = client.get("/api/hotspots", params={"subset": "fatal-only"})
        assert response.status_code == 422
        assert response.json() == {"errors": [{"field": "subset", "message": "Choose one of the listed options."}]}


def test_out_of_range_limit_is_a_friendly_422(make_client, dummy_model_path, sample_path):
    with make_client(dummy_model_path, hotspot_path=sample_path) as client:
        response = client.get("/api/hotspots", params={"limit": 5000})
        assert response.status_code == 422
        assert response.json() == {"errors": [{"field": "limit", "message": "Enter a number of at most 1000."}]}


def test_unknown_slice_is_a_422(make_client, dummy_model_path, sample_path):
    with make_client(dummy_model_path, hotspot_path=sample_path) as client:
        response = client.get("/api/hotspots", params={"slice": "Lunchtime"})
        assert response.json() == {"errors": [{"field": "slice", "message": "Choose one of the listed options."}]}


def test_malformed_file_is_reported_by_name(make_client, dummy_model_path, tmp_path):
    data = build_sample()
    data["hotspots"][0] = copy.deepcopy(data["hotspots"][0])
    data["hotspots"][0]["collisions"] = 999
    path = tmp_path / "bad.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    with make_client(dummy_model_path, hotspot_path=path) as client:
        response = client.get("/api/hotspots")
        assert response.status_code == 503
        assert "hotspots[0]" in response.json()["message"]
        assert "must equal fatal + serious + slight" in response.json()["message"]


def test_file_that_is_not_json_is_reported(make_client, dummy_model_path, tmp_path):
    path = tmp_path / "broken.json"
    path.write_text("{not json", encoding="utf-8")
    with make_client(dummy_model_path, hotspot_path=path) as client:
        assert "not valid JSON" in client.get("/api/hotspots/meta").json()["message"]


def test_every_problem_is_reported_not_just_the_first(tmp_path):
    from backend.schemas.hotspots import HotspotFileError, parse_hotspot_data

    data = build_sample()
    data["hotspots"][0]["collisions"] = 999
    data["hotspots"][1]["latitude"] = 40.0
    data["hotspots"][2]["slice"] = "Lunchtime"
    with pytest.raises(HotspotFileError) as raised:
        parse_hotspot_data(data)
    assert len(raised.value.problems) == 3


def test_severe_hotspot_cannot_count_slight_collisions():
    from backend.schemas.hotspots import HotspotFileError, parse_hotspot_data

    data = build_sample()
    severe = next(h for h in data["hotspots"] if h["subset"] == "severe")
    severe["slight"] = 3
    severe["collisions"] = severe["fatal"] + severe["serious"] + 3
    with pytest.raises(HotspotFileError) as raised:
        parse_hotspot_data(data)
    assert any("severe hotspot cannot count Slight" in problem for problem in raised.value.problems)


def test_real_hotspot_path_is_refused_without_force(monkeypatch, tmp_path):
    import sys
    from backend.config import DEFAULT_HOTSPOT_PATH
    from tools import make_sample_hotspots

    # The real file may exist (it is generated by the clustering notebook), so check it is left untouched.
    before = DEFAULT_HOTSPOT_PATH.read_bytes() if DEFAULT_HOTSPOT_PATH.exists() else None
    monkeypatch.setattr(sys, "argv", ["make_sample_hotspots.py", str(DEFAULT_HOTSPOT_PATH)])
    with pytest.raises(SystemExit) as raised:
        make_sample_hotspots.main()
    assert raised.value.code == 1
    after = DEFAULT_HOTSPOT_PATH.read_bytes() if DEFAULT_HOTSPOT_PATH.exists() else None
    assert after == before
