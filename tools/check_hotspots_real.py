"""Smoke test of the hotspot endpoints against a running backend, using the real data.

Usage (from the repo root, with the backend running on port 8000):
    python tools/check_hotspots_real.py
    python tools/check_hotspots_real.py --base http://127.0.0.1:8000

It prints the meta, then checks: a nearby search at the top severe hotspot's own centre (it must return that hotspot
at about 0 m), its details (the profile sums must match its collisions), and an along-route call on a straight line
between two real hotspots (both must appear, in order). Exit code 0 means every check passed.
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


def get(base: str, path: str) -> dict:
    with urllib.request.urlopen(base + path) as response:
        return json.load(response)


def post(base: str, path: str, body: dict) -> dict:
    request = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def check(label: str, passed: bool, detail: str = "") -> bool:
    print(f"{'PASS' if passed else 'FAIL'}  {label}{(' - ' + detail) if detail else ''}")
    return passed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    base = args.base
    results: list[bool] = []

    meta = get(base, "/api/hotspots/meta")
    print("META")
    print(json.dumps({key: meta[key] for key in ("method", "total_hotspots", "hotspots_per_subset", "features")}, indent=2))
    results.append(check("meta reports the version 2 features", all(meta["features"].values())))

    top = get(base, "/api/hotspots?subset=severe&slice=" + urllib.parse.quote("All times") + "&limit=1")["hotspots"][0]
    print(f"\nTOP SEVERE HOTSPOT: id {top['id']}, {top['collisions']} collisions, "
          f"at {top['latitude']}, {top['longitude']}")

    nearby = get(base, "/api/hotspots/nearby?" + urllib.parse.urlencode({
        "latitude": top["latitude"], "longitude": top["longitude"], "radius_m": 50, "subset": "severe",
        "slice": "All times", "limit": 5,
    }))
    first = nearby["hotspots"][0] if nearby["hotspots"] else None
    print("\nNEARBY at its own centre (50 m):")
    print(json.dumps(first, indent=2))
    results.append(check(
        "nearby returns the hotspot itself at about 0 m",
        first is not None and first["id"] == top["id"] and first["distance_m"] <= 1,
        f"distance_m={first['distance_m'] if first else None}",
    ))

    details = get(base, f"/api/hotspots/{top['id']}")
    profile = details["profile"]
    sums = {
        "years": sum(item["collisions"] for item in profile["years"]),
        "months": sum(item["collisions"] for item in profile["months"]),
        "time_of_day": sum(item["collisions"] for item in profile["time_of_day"]),
    }
    print("\nDETAILS sums:", sums, "collisions", top["collisions"])
    results.append(check(
        "profile sums equal the hotspot's collisions",
        all(value == top["collisions"] for value in sums.values()),
    ))

    severe = get(base, "/api/hotspots?subset=severe&slice=" + urllib.parse.quote("All times") + "&limit=40")["hotspots"]
    far_apart = [h for h in severe if h["id"] != top["id"]]
    pair = None
    for other in far_apart:
        if abs(other["latitude"] - top["latitude"]) + abs(other["longitude"] - top["longitude"]) > 0.02:
            pair = (top, other)
            break
    if pair is None:
        results.append(check("found two hotspots to route between", False))
    else:
        start, end = pair
        route = post(base, "/api/hotspots/along-route", {
            "path": [[start["latitude"], start["longitude"]], [end["latitude"], end["longitude"]]],
            "buffer_m": 200, "subset": "severe", "slice": "All times", "min_collisions": 1,
        })
        ids = [item["id"] for item in route["hotspots"]]
        positions = {item["id"]: item["km_from_start"] for item in route["hotspots"]}
        print(f"\nALONG-ROUTE from id {start['id']} to id {end['id']}: {route['count']} hotspots, "
              f"length {route['length_km']} km")
        results.append(check(
            "both route ends appear, in order",
            start["id"] in ids and end["id"] in ids and positions[start["id"]] <= positions[end["id"]],
            f"km {positions.get(start['id'])} then {positions.get(end['id'])}",
        ))

    passed = all(results)
    print("\nALL CHECKS PASSED" if passed else "\nSOME CHECKS FAILED")
    return 0 if passed else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.URLError as exc:
        print(f"Could not reach the backend: {exc}. Start it with: python -m uvicorn backend.app:app --port 8000")
        sys.exit(1)
