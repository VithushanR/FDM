"""The version 2 hotspot endpoints, on sample files written into temp folders. Real data is not used here."""

import gzip
import json
import math
from pathlib import Path

import pytest

from backend.routers import hotspots as hotspot_router
from tools.make_sample_hotspots import build_sample, build_sample_v2

EARTH_R = 6371008.8
NOT_IN_FILE = "not available in this data file"
UNAVAILABLE = {"available": False, "message": "Hotspot analysis has not been generated yet."}


def metres_north(lat: float, lon: float, metres: float) -> tuple[float, float]:
    return lat + metres / (EARTH_R * math.pi / 180), lon


def write_v2(directory: Path, mutate=None, profile_mutate=None) -> Path:
    hotspots, profiles = build_sample_v2()
    if mutate is not None:
        mutate(hotspots["hotspots"])
    if profile_mutate is not None:
        profile_mutate(profiles)
    path = directory / "hotspots.json"
    path.write_text(json.dumps(hotspots), encoding="utf-8")
    with gzip.open(directory / "hotspot_profiles.json.gz", "wt", encoding="utf-8") as handle:
        json.dump(profiles, handle)
    return path


def far_away(rows: list[dict]) -> None:
    """Moves every row to a place no test uses, so only the rows a test places are near anything."""
    for row in rows:
        row["latitude"], row["longitude"] = 56.0, -3.0


def place(rows: list[dict], row_id: int, lat: float, lon: float) -> None:
    rows[row_id - 1]["latitude"], rows[row_id - 1]["longitude"] = lat, lon


def severe_all_times(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r["subset"] == "severe" and r["slice"] == "All times" and r["month"] is None]


@pytest.fixture
def client_for(make_client, dummy_model_path):
    def start(hotspot_path: Path):
        return make_client(dummy_model_path, hotspot_path=hotspot_path)
    return start


# Meta and the list

def test_meta_reports_every_version_2_feature(tmp_path, client_for):
    with client_for(write_v2(tmp_path)) as client:
        meta = client.get("/api/hotspots/meta").json()
        assert meta["features"] == {
            "bbox": True, "nearby": True, "details": True, "route": True, "contains": True, "counts": True,
            "months": True, "persistence": True, "total_matched": True,
        }
        assert meta["months"][0] == "January"
        assert meta["persistence_labels"][-1] == "Too few to judge"
        assert meta["years"] == [2021, 2022, 2023, 2024, 2025]
        assert meta["persistence_rules"]["persistent"] == "collisions in at least 4 of the 5 years"
        assert meta["hotspots_per_subset"]["all"] + meta["hotspots_per_subset"]["severe"] == meta["total_hotspots"]


def test_default_requests_never_return_month_rows(tmp_path, client_for):
    with client_for(write_v2(tmp_path)) as client:
        body = client.get("/api/hotspots?subset=all&slice=All%20times&min_collisions=1&limit=1000").json()
        assert body["hotspots"], "the sample should have All times rows"
        assert all(row["month"] is None for row in body["hotspots"])


def test_month_view_returns_only_that_month(tmp_path, client_for):
    with client_for(write_v2(tmp_path)) as client:
        body = client.get("/api/hotspots?subset=all&month=3&min_collisions=1&limit=1000").json()
        assert body["hotspots"]
        assert all(row["month"] == 3 and row["slice"] == "All times" for row in body["hotspots"])


def test_month_with_a_time_of_day_slice_is_refused(tmp_path, client_for):
    with client_for(write_v2(tmp_path)) as client:
        response = client.get("/api/hotspots?subset=all&slice=Night&month=3")
        assert response.status_code == 422
        assert response.json()["errors"][0]["field"] == "month"


def test_bbox_edges_are_inclusive(tmp_path, client_for):
    def mutate(rows):
        far_away(rows)
        place(rows, 1, 51.5, -0.2)  # on the south-west corner
        place(rows, 2, 51.6, 0.0)   # on the north-east corner
        place(rows, 3, 51.61, 0.0)  # just outside the north edge
    with client_for(write_v2(tmp_path, mutate)) as client:
        body = client.get("/api/hotspots?subset=all&min_collisions=1&bbox=-0.2,51.5,0.0,51.6&limit=1000").json()
        ids = sorted(row["id"] for row in body["hotspots"])
        assert 1 in ids and 2 in ids and 3 not in ids


def test_bbox_must_be_ordered_and_have_four_numbers(tmp_path, client_for):
    with client_for(write_v2(tmp_path)) as client:
        assert client.get("/api/hotspots?bbox=1,2,3").json()["errors"][0]["field"] == "bbox"
        assert "West must be less than east" in client.get("/api/hotspots?bbox=1,50,0,51").json()["errors"][0]["message"]
        assert "South must be less than north" in client.get("/api/hotspots?bbox=-1,52,0,51").json()["errors"][0]["message"]


def test_persistence_filter_matches_the_labels(tmp_path, client_for):
    path = write_v2(tmp_path)
    rows = json.loads(path.read_text())["hotspots"]
    expected = [r for r in rows if r["subset"] == "all" and r["slice"] == "All times" and r["month"] is None
                and r["persistence"] == "Too few to judge"]
    with client_for(path) as client:
        body = client.get("/api/hotspots?subset=all&min_collisions=1&persistence=too_few&limit=1000").json()
        assert body["total_matched"] == len(expected)
        assert all(row["persistence"] == "Too few to judge" for row in body["hotspots"])
        bad = client.get("/api/hotspots?persistence=sometimes")
        assert bad.json()["errors"][0]["field"] == "persistence"


def no_deaths(row: dict) -> None:
    """Makes a hotspot Serious only. The total stays the same, so the profile still adds up."""
    row["serious"] += row["fatal"]
    row["fatal"] = 0


def test_contains_keeps_hotspots_with_a_death_or_a_severe_collision(tmp_path, client_for):
    def mutate(rows):
        no_deaths(severe_all_times(rows)[0])
        no_deaths(severe_all_times(rows)[2])
    path = write_v2(tmp_path, mutate)
    rows = severe_all_times(json.loads(path.read_text())["hotspots"])
    expected = sorted(r["id"] for r in rows if r["fatal"] > 0)
    assert 0 < len(expected) < len(rows), "the sample needs hotspots with and without a death"
    with client_for(path) as client:
        body = client.get("/api/hotspots?subset=severe&min_collisions=1&contains=fatal&limit=1000").json()
        assert sorted(row["id"] for row in body["hotspots"]) == expected
        assert body["total_matched"] == len(expected)
        severe = client.get("/api/hotspots?subset=severe&min_collisions=1&contains=severe&limit=1000").json()
        assert severe["total_matched"] == len(rows)
        bad = client.get("/api/hotspots?contains=slight")
        assert bad.json()["errors"][0]["field"] == "contains"


def test_contains_severe_drops_hotspots_with_only_slight_collisions(tmp_path, client_for):
    def mutate(rows):
        row = next(r for r in rows if r["subset"] == "all" and r["slice"] == "All times" and r["month"] is None)
        row["slight"] += row["fatal"] + row["serious"]
        row["fatal"] = row["serious"] = 0
    path = write_v2(tmp_path, mutate)
    rows = [r for r in json.loads(path.read_text())["hotspots"]
            if r["subset"] == "all" and r["slice"] == "All times" and r["month"] is None]
    expected = sorted(r["id"] for r in rows if r["fatal"] + r["serious"] > 0)
    assert len(expected) < len(rows)
    with client_for(path) as client:
        body = client.get("/api/hotspots?subset=all&min_collisions=1&contains=severe&limit=1000").json()
        assert sorted(row["id"] for row in body["hotspots"]) == expected


def test_counts_match_the_list_for_each_contains_value(tmp_path, client_for):
    def mutate(rows):
        no_deaths(severe_all_times(rows)[0])
    path = write_v2(tmp_path, mutate)
    with client_for(path) as client:
        counts = client.get("/api/hotspots/counts?subset=severe&min_collisions=1").json()
        for key, contains in (("collisions", "any"), ("fatal", "fatal"), ("severe", "severe")):
            listed = client.get(f"/api/hotspots?subset=severe&min_collisions=1&contains={contains}&limit=1").json()
            assert counts[key] == listed["total_matched"]
        assert counts["fatal"] < counts["collisions"]
        assert client.get("/api/hotspots/counts?subset=nobody").json()["errors"][0]["field"] == "subset"


def test_route_with_contains_fatal_skips_hotspots_without_a_death(tmp_path, client_for):
    def mutate(rows):
        far_away(rows)
        severe = severe_all_times(rows)
        with_death, without = severe[0], severe[1]
        no_deaths(without)
        place(rows, with_death["id"], *metres_north(51.5, 0.0, 50))
        place(rows, without["id"], *metres_north(51.5, 0.1, 50))
    path = write_v2(tmp_path, mutate)
    route = {"path": [[51.5, -0.2], [51.5, 0.2]], "buffer_m": 100, "subset": "severe", "min_collisions": 1}
    with client_for(path) as client:
        every = client.post("/api/hotspots/along-route", json=route).json()["hotspots"]
        fatal_only = client.post("/api/hotspots/along-route", json={**route, "contains": "fatal"}).json()["hotspots"]
        assert len(every) == 2
        assert len(fatal_only) == 1 and fatal_only[0]["fatal"] > 0
        bad = client.post("/api/hotspots/along-route", json={**route, "contains": 3})
        assert bad.json()["errors"][0]["field"] == "contains"


def test_sort_modes_order_the_results(tmp_path, client_for):
    with client_for(write_v2(tmp_path)) as client:
        by_collisions = client.get("/api/hotspots?subset=all&min_collisions=1&limit=1000").json()["hotspots"]
        counts = [row["collisions"] for row in by_collisions]
        assert counts == sorted(counts, reverse=True)
        by_fatal = client.get("/api/hotspots?subset=all&min_collisions=1&sort=fatal&limit=1000").json()["hotspots"]
        fatals = [row["fatal"] for row in by_fatal]
        assert fatals == sorted(fatals, reverse=True)
        by_severe = client.get("/api/hotspots?subset=all&min_collisions=1&sort=severe&limit=1000").json()["hotspots"]
        severes = [row["fatal"] + row["serious"] for row in by_severe]
        assert severes == sorted(severes, reverse=True)
        by_share = client.get("/api/hotspots?subset=all&min_collisions=1&sort=share&limit=1000").json()["hotspots"]
        shares = [(row["fatal"] + row["serious"]) / row["collisions"] for row in by_share]
        assert shares == sorted(shares, reverse=True)
        assert client.get("/api/hotspots?sort=loudest").json()["errors"][0]["field"] == "sort"


def test_total_matched_and_truncated(tmp_path, client_for):
    with client_for(write_v2(tmp_path)) as client:
        body = client.get("/api/hotspots?subset=all&min_collisions=1&limit=2").json()
        assert body["count"] == 2
        assert body["total_matched"] > 2
        assert body["truncated"] is True
        full = client.get("/api/hotspots?subset=all&min_collisions=1&limit=1000").json()
        assert full["truncated"] == (full["total_matched"] > full["count"])


# Nearby

def test_nearby_orders_by_distance_and_cuts_at_the_radius(tmp_path, client_for):
    chosen = []

    def mutate(rows):
        far_away(rows)
        chosen.extend(r["id"] for r in severe_all_times(rows)[:4])
        for metres, row_id in [(0, chosen[0]), (300, chosen[1]), (1200, chosen[2]), (3000, chosen[3])]:
            place(rows, row_id, *metres_north(51.5, -0.12, metres))

    with client_for(write_v2(tmp_path, mutate)) as client:
        near = client.get("/api/hotspots/nearby?latitude=51.5&longitude=-0.12&radius_m=2000&limit=10").json()
        assert [item["id"] for item in near["hotspots"]] == chosen[:3]
        assert [item["distance_m"] for item in near["hotspots"]] == [0, 300, 1200]
        small = client.get("/api/hotspots/nearby?latitude=51.5&longitude=-0.12&radius_m=1000&limit=10").json()
        assert [item["id"] for item in small["hotspots"]] == chosen[:2]


def test_nearby_uses_the_centre_and_reports_busiest_time(tmp_path, client_for):
    chosen = []

    def mutate(rows):
        far_away(rows)
        night = next(r for r in rows if r["subset"] == "severe" and r["slice"] == "Night")
        chosen.append(night["id"])
        place(rows, night["id"], 51.5, -0.12)

    with client_for(write_v2(tmp_path, mutate)) as client:
        body = client.get("/api/hotspots/nearby?latitude=51.5&longitude=-0.12&radius_m=50&subset=severe&slice=Night").json()
        assert [item["id"] for item in body["hotspots"]] == chosen
        assert body["hotspots"][0]["busiest_time"] == "Night"


def test_nearby_validation_errors(tmp_path, client_for):
    with client_for(write_v2(tmp_path)) as client:
        assert client.get("/api/hotspots/nearby?longitude=-0.1").json()["errors"][0] == {
            "field": "latitude", "message": "This field is required."}
        bad = client.get("/api/hotspots/nearby?latitude=40&longitude=-0.1").json()["errors"]
        assert bad == [{"field": "latitude", "message": "Enter a number from 49 to 61."}]
        radius = client.get("/api/hotspots/nearby?latitude=51.5&longitude=-0.1&radius_m=10").json()["errors"]
        assert radius[0]["field"] == "radius_m"
        limit = client.get("/api/hotspots/nearby?latitude=51.5&longitude=-0.1&limit=99").json()["errors"]
        assert limit[0]["field"] == "limit"


# Details and profiles

def test_details_sums_gb_share_and_persistence(tmp_path, client_for):
    path = write_v2(tmp_path)
    rows = json.loads(path.read_text())["hotspots"]
    row = next(r for r in rows if r["subset"] == "all" and r["slice"] == "All times" and r["month"] is None)
    with client_for(path) as client:
        body = client.get(f"/api/hotspots/{row['id']}").json()
        profile = body["profile"]
        assert sum(item["collisions"] for item in profile["years"]) == row["collisions"]
        assert sum(item["collisions"] for item in profile["months"]) == row["collisions"]
        assert sum(item["collisions"] for item in profile["time_of_day"]) == row["collisions"]
        assert [share["key"] for share in profile["shares"]][0] == "motorcycle"
        for share in profile["shares"]:
            assert share["gb_pct"] == 20.0  # the sample's "all" baseline
            expected = round(share["count"] / row["collisions"] * 100, 1)
            assert share["here_pct"] == expected
        assert body["persistence"]["label"] == row["persistence"]
        assert body["persistence"]["years_present"] == row["years_present"]


def test_details_for_an_unknown_id_is_a_404(tmp_path, client_for):
    with client_for(write_v2(tmp_path)) as client:
        response = client.get("/api/hotspots/999999")
        assert response.status_code == 404
        assert response.json() == {"detail": "No hotspot with id 999999."}


def test_a_profile_whose_sums_do_not_match_is_reported(tmp_path, client_for):
    def break_sum(profiles):
        profiles["profiles"]["1"]["y"][0] += 3

    def mutate(rows):
        far_away(rows)
        place(rows, 1, 51.5, -0.12)

    with client_for(write_v2(tmp_path, mutate, profile_mutate=break_sum)) as client:
        response = client.get("/api/hotspots/1")
        assert response.status_code == 503
        assert "the years add up to" in response.json()["message"]
        # Nearby still works, without busiest_time, because the profiles are unusable.
        near = client.get("/api/hotspots/nearby?latitude=51.5&longitude=-0.12&radius_m=50&subset=all").json()
        assert near["hotspots"][0]["id"] == 1
        assert near["hotspots"][0]["busiest_time"] is None


# Along-route

def test_route_finds_hotspots_at_the_buffer_edges_and_km_from_start(tmp_path, client_for):
    def mutate(rows):
        far_away(rows)
        place(rows, 1, *metres_north(51.5, 0.0, 80))  # 80 m north of the middle of the route
    path = write_v2(tmp_path, mutate)
    route = [[51.5, -0.2], [51.5, 0.2]]
    expected_km = 0.2 * 111195 * math.cos(math.radians(51.5)) / 1000
    with client_for(path) as client:
        inside = client.post("/api/hotspots/along-route", json={"path": route, "buffer_m": 100, "subset": "all", "min_collisions": 1}).json()
        hit = next(item for item in inside["hotspots"] if item["id"] == 1)
        assert hit["distance_from_route_m"] == pytest.approx(80, abs=1)
        assert hit["km_from_start"] == pytest.approx(expected_km, rel=0.01)
        outside = client.post("/api/hotspots/along-route", json={"path": route, "buffer_m": 50, "subset": "all", "min_collisions": 1}).json()
        assert all(item["id"] != 1 for item in outside["hotspots"])


def test_route_summary_and_cap(tmp_path, client_for, monkeypatch):
    def mutate(rows):
        far_away(rows)
        for index in range(1, 6):
            place(rows, index, *metres_north(51.5, -0.1 + index * 0.02, 10))
    path = write_v2(tmp_path, mutate)
    monkeypatch.setattr(hotspot_router, "ROUTE_CAP", 2)
    with client_for(path) as client:
        body = client.post("/api/hotspots/along-route", json={"path": [[51.5, -0.2], [51.5, 0.0]], "buffer_m": 100, "subset": "all", "min_collisions": 1}).json()
        assert body["count"] == 2
        assert body["truncated"] is True
        assert body["summary"]["hotspots"] >= 5
        assert body["summary"]["per_10_km"] is not None


def test_route_validation_errors(tmp_path, client_for):
    with client_for(write_v2(tmp_path)) as client:
        one = client.post("/api/hotspots/along-route", json={"path": [[51.5, -0.1]]}).json()["errors"]
        assert one == [{"field": "path", "message": "Enter at least 2 points."}]
        outside = client.post("/api/hotspots/along-route", json={"path": [[51.5, -0.1], [40.0, 0.0]]}).json()["errors"]
        assert outside[0]["field"] == "path" and "outside the area" in outside[0]["message"]
        buffer = client.post("/api/hotspots/along-route", json={"path": [[51.5, -0.1], [51.6, 0.0]], "buffer_m": 5}).json()["errors"]
        assert buffer[0]["field"] == "buffer_m"
        conflict = client.post("/api/hotspots/along-route", json={"path": [[51.5, -0.1], [51.6, 0.0]], "month": 3, "slice": "Night"}).json()["errors"]
        assert conflict[0]["field"] == "month"
        not_object = client.post("/api/hotspots/along-route", json=[1, 2]).json()["errors"]
        assert not_object[0]["field"] == "body"


def test_route_at_the_point_limit_is_accepted(tmp_path, client_for):
    with client_for(write_v2(tmp_path)) as client:
        path = [[51.5, -0.1 + i * 0.0001] for i in range(2000)]
        assert client.post("/api/hotspots/along-route", json={"path": path, "subset": "all"}).status_code == 200
        too_many = [[51.5, -0.1]] * 2001
        assert client.post("/api/hotspots/along-route", json={"path": too_many}).json()["errors"][0]["field"] == "path"


# Unavailable and damaged files

def test_missing_hotspot_file_is_a_503_on_every_endpoint(tmp_path, client_for):
    with client_for(tmp_path / "absent.json") as client:
        assert client.get("/api/hotspots?subset=all").json() == UNAVAILABLE
        assert client.get("/api/hotspots/meta").json() == UNAVAILABLE
        assert client.get("/api/hotspots/nearby?latitude=51.5&longitude=-0.1").json() == UNAVAILABLE
        assert client.get("/api/hotspots/1").json() == UNAVAILABLE
        assert client.post("/api/hotspots/along-route", json={"path": [[51.5, -0.1], [51.6, 0.0]]}).json() == UNAVAILABLE


def test_missing_profiles_disable_details_only(tmp_path, client_for):
    path = write_v2(tmp_path)
    (tmp_path / "hotspot_profiles.json.gz").unlink()
    with client_for(path) as client:
        assert client.get("/api/hotspots/1").json() == {
            "available": False, "message": "Hotspot profiles have not been generated yet."}
        assert client.get("/api/hotspots/meta").json()["features"]["details"] is False
        near = client.get("/api/hotspots/nearby?latitude=51.5&longitude=-0.1&radius_m=2000&limit=3")
        assert near.status_code == 200
        assert all(item["busiest_time"] is None for item in near.json()["hotspots"])


def test_a_corrupt_profile_file_is_named(tmp_path, client_for):
    path = write_v2(tmp_path)
    (tmp_path / "hotspot_profiles.json.gz").write_bytes(b"not gzip at all")
    with client_for(path) as client:
        message = client.get("/api/hotspots/1").json()["message"]
        assert "hotspot_profiles.json.gz could not be read" in message


def test_a_corrupt_hotspot_file_is_named(tmp_path, client_for):
    path = tmp_path / "hotspots.json"
    path.write_text("{not json", encoding="utf-8")
    with client_for(path) as client:
        body = client.get("/api/hotspots").json()
        assert body["available"] is False
        assert "not valid JSON" in body["message"]


def test_a_version_2_row_with_bad_counts_is_named(tmp_path, client_for):
    def break_counts(rows):
        rows[0]["fatal"] += 5
    path = write_v2(tmp_path, break_counts)
    with client_for(path) as client:
        message = client.get("/api/hotspots").json()["message"]
        assert "hotspots[0]" in message and "must equal fatal + serious + slight" in message


# Version 1 files

def test_a_version_1_file_turns_the_new_features_off(tmp_path, client_for):
    path = tmp_path / "v1.json"
    path.write_text(json.dumps(build_sample()), encoding="utf-8")
    with client_for(path) as client:
        meta = client.get("/api/hotspots/meta").json()
        assert not any(meta["features"].values())
        assert client.get("/api/hotspots?subset=all&month=3").json()["errors"][0] == {"field": "month", "message": NOT_IN_FILE}
        assert client.get("/api/hotspots?subset=all&persistence=recent").json()["errors"][0]["message"] == NOT_IN_FILE
        assert client.get("/api/hotspots?subset=all&bbox=-1,50,1,52").json()["errors"][0]["message"] == NOT_IN_FILE
        assert client.get("/api/hotspots?subset=all&contains=fatal").json()["errors"][0] == {
            "field": "contains", "message": NOT_IN_FILE}
        assert client.get("/api/hotspots/counts?subset=all").json()["errors"][0] == {"field": "file", "message": NOT_IN_FILE}
        assert client.get("/api/hotspots/nearby?latitude=51.5&longitude=-0.1").json()["errors"][0] == {
            "field": "file", "message": NOT_IN_FILE}
        assert client.get("/api/hotspots/1").json()["errors"][0]["message"] == NOT_IN_FILE
        assert client.post("/api/hotspots/along-route", json={"path": [[51.5, -0.1], [51.6, 0.0]]}).json()["errors"][0]["message"] == NOT_IN_FILE
        plain = client.get("/api/hotspots?subset=all&slice=All%20times&limit=3").json()
        assert plain["count"] == 3 and plain["hotspots"][0]["month"] is None


# OpenAPI

def test_openapi_lists_the_new_paths(client):
    spec = client.get("/openapi.json").json()
    assert "/api/hotspots/nearby" in spec["paths"]
    assert "/api/hotspots/{hotspot_id}" in spec["paths"]
    assert "/api/hotspots/along-route" in spec["paths"]
    assert "post" in spec["paths"]["/api/hotspots/along-route"]
    assert "NearbyListOut" in spec["components"]["schemas"]
    assert "AlongRouteOut" in spec["components"]["schemas"]

