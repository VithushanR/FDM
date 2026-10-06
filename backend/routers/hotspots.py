import math

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from ..schemas.classification import location_range_errors
from ..schemas.common import ApiValidationError
from ..schemas.hotspots import (
    ALL_TIMES, PERSISTENCE_PARAMS, AlongRouteOut, DetailsOut, HotspotListOut, NearbyListOut,
)
from ..services.hotspot_service import HotspotService, HotspotUnavailable, get_hotspot_service
from ..services.hotspot_store import HotspotStore

router = APIRouter(prefix="/api/hotspots", tags=["hotspots"])
BAD_OPTION = "Choose one of the listed options."
NOT_IN_FILE = "not available in this data file"
SORTS = ("collisions", "fatal", "share")
ROUTE_CAP = 5000
ROUTE_POINTS = (2, 2000)
ROUTE_BUFFER = (50, 1000)


def _unavailable(exc: HotspotUnavailable) -> JSONResponse:
    return JSONResponse(status_code=503, content={"available": False, "message": exc.message})


def _load(service: HotspotService) -> HotspotStore | JSONResponse:
    try:
        return service.load()
    except HotspotUnavailable as exc:
        return _unavailable(exc)


def _read_filters(
    store: HotspotStore,
    *,
    subset: str,
    slice_name: str,
    month: int | None,
    persistence: str,
    min_collisions: int,
) -> tuple[dict, dict[str, str]]:
    """Checks the shared filters. Returns the keyword arguments for the store queries, and the errors."""
    errors: dict[str, str] = {}
    if subset not in store.subsets:
        errors["subset"] = BAD_OPTION
    if slice_name not in store.slices:
        errors["slice"] = BAD_OPTION
    if month is not None and slice_name != ALL_TIMES:
        errors["month"] = "A month view uses the All times slice. Choose All times, or remove the month."
    if persistence not in PERSISTENCE_PARAMS:
        errors["persistence"] = BAD_OPTION
    if not store.is_v2:
        if month is not None:
            errors["month"] = NOT_IN_FILE
        if persistence != "any":
            errors["persistence"] = NOT_IN_FILE
    filters = {
        "subset": subset,
        "slice_name": slice_name,
        "month": month,
        "persistence_label": PERSISTENCE_PARAMS.get(persistence),
        "min_collisions": min_collisions,
    }
    return filters, errors


def _parse_bbox(text: str) -> tuple[tuple[float, float, float, float] | None, str | None]:
    message = "Enter four numbers: west,south,east,north, in degrees."
    parts = [part.strip() for part in text.split(",")]
    if len(parts) != 4:
        return None, message
    try:
        west, south, east, north = (float(part) for part in parts)
    except ValueError:
        return None, message
    if not all(math.isfinite(value) for value in (west, south, east, north)):
        return None, message
    if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= 90 and -90 <= north <= 90):
        return None, "The numbers must be longitudes from -180 to 180 and latitudes from -90 to 90."
    if west >= east:
        return None, "West must be less than east."
    if south >= north:
        return None, "South must be less than north."
    return (west, south, east, north), None


@router.get("", response_model=HotspotListOut)
def list_hotspots(
    service: HotspotService = Depends(get_hotspot_service),
    subset: str = "all",
    slice_: str = Query("All times", alias="slice"),
    min_collisions: int = Query(1, ge=1),
    limit: int = Query(200, ge=1, le=1000),
    month: int | None = Query(None, ge=1, le=12),
    persistence: str = "any",
    bbox: str | None = None,
    sort: str = "collisions",
):
    store = _load(service)
    if isinstance(store, JSONResponse):
        return store
    filters, errors = _read_filters(
        store, subset=subset, slice_name=slice_, month=month, persistence=persistence, min_collisions=min_collisions,
    )
    box = None
    if bbox is not None:
        if not store.is_v2:
            errors["bbox"] = NOT_IN_FILE
        else:
            box, problem = _parse_bbox(bbox)
            if problem:
                errors["bbox"] = problem
    if sort not in SORTS:
        errors["sort"] = BAD_OPTION
    if errors:
        raise ApiValidationError(errors)

    rows = store.band(box[1], box[3]) if box else store.all_rows()
    rows = store.select(rows, **filters, bbox=box)
    ordered = store.sorted_rows(rows, sort)
    chosen = ordered[:limit]
    return {
        "count": len(chosen),
        "subset": subset,
        "slice": slice_,
        "total_matched": int(len(ordered)),
        "truncated": bool(len(ordered) > len(chosen)),
        "hotspots": [store.row(int(i)) for i in chosen],
    }


@router.get("/meta")
def hotspot_meta(service: HotspotService = Depends(get_hotspot_service)):
    store = _load(service)
    if isinstance(store, JSONResponse):
        return store
    v2 = store.is_v2
    profiles = None
    if v2:
        try:
            profiles = service.profiles()
        except HotspotUnavailable:
            profiles = None
    features = {
        "bbox": v2,
        "nearby": v2,
        "details": profiles is not None,
        "route": v2,
        "months": v2,
        "persistence": v2,
        "total_matched": v2,
    }
    return {
        "generated_at": store.generated_at,
        "method": store.method,
        "parameters": store.parameters,
        "subsets": store.subsets,
        "slices": store.slices,
        "total_hotspots": store.count,
        "months": store.months,
        "years": profiles.years if profiles is not None else None,
        "persistence_labels": store.persistence_labels,
        "persistence_rules": store.parameters.get("persistence_rules") if v2 else None,
        "features": features,
        "hotspots_per_subset": store.counts_by_subset(),
    }


@router.get("/nearby", response_model=NearbyListOut)
def nearby(
    service: HotspotService = Depends(get_hotspot_service),
    latitude: float | None = Query(None),
    longitude: float | None = Query(None),
    radius_m: int = Query(500, ge=50, le=2000),
    subset: str = "severe",
    slice_: str = Query("All times", alias="slice"),
    month: int | None = Query(None, ge=1, le=12),
    min_collisions: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
):
    store = _load(service)
    if isinstance(store, JSONResponse):
        return store
    errors: dict[str, str] = {}
    if not store.is_v2:
        errors["file"] = NOT_IN_FILE
    if latitude is None:
        errors["latitude"] = "This field is required."
    if longitude is None:
        errors["longitude"] = "This field is required."
    if latitude is not None and longitude is not None:
        errors.update(location_range_errors(latitude, longitude))
    filters, filter_errors = _read_filters(
        store, subset=subset, slice_name=slice_, month=month, persistence="any", min_collisions=min_collisions,
    )
    errors.update(filter_errors)
    if errors or latitude is None or longitude is None:
        raise ApiValidationError(errors)

    filters.pop("persistence_label")
    rows, distances = store.nearby(latitude, longitude, radius_m, **filters)
    chosen, chosen_distances = rows[:limit], distances[:limit]
    profiles = None
    try:
        profiles = service.profiles()
    except HotspotUnavailable:
        profiles = None
    results = []
    for index, distance in zip(chosen, chosen_distances):
        item = store.row(int(index))
        item["distance_m"] = int(round(float(distance)))
        item["busiest_time"] = profiles.busiest_time(int(index)) if profiles is not None else None
        results.append(item)
    return {"count": len(results), "radius_m": radius_m, "hotspots": results}


@router.get("/{hotspot_id}", response_model=DetailsOut)
def hotspot_details(hotspot_id: int, service: HotspotService = Depends(get_hotspot_service)):
    store = _load(service)
    if isinstance(store, JSONResponse):
        return store
    if not store.is_v2:
        raise ApiValidationError({"file": NOT_IN_FILE})
    if not 1 <= hotspot_id <= store.count:
        return JSONResponse(status_code=404, content={"detail": f"No hotspot with id {hotspot_id}."})
    try:
        profiles = service.profiles()
    except HotspotUnavailable as exc:
        return _unavailable(exc)
    i = hotspot_id - 1
    row = store.row(i)
    collisions = row["collisions"]
    return {
        "hotspot": row,
        "profile": {
            "years": [{"year": year, "collisions": int(profiles.y[i, k])} for k, year in enumerate(profiles.years)],
            "months": [{"month": month, "collisions": int(profiles.m[i, k])} for k, month in enumerate(profiles.months)],
            "time_of_day": [
                {"slice": name, "collisions": int(profiles.t[i, k])} for k, name in enumerate(profiles.time_slices)
            ],
            "shares": profiles.shares(i, collisions, row["subset"]),
            "baseline_subset": row["subset"],
        },
        "persistence": {
            "label": row["persistence"],
            "years_present": row["years_present"],
            "rules": store.parameters.get("persistence_rules", {}),
        },
    }


def _parse_path(value: object) -> tuple[list[tuple[float, float]], str | None]:
    if not isinstance(value, list):
        return [], "Send the path as a list of [latitude, longitude] points."
    low, high = ROUTE_POINTS
    if len(value) < low:
        return [], f"Enter at least {low} points."
    if len(value) > high:
        return [], f"Enter at most {high} points."
    points: list[tuple[float, float]] = []
    for index, item in enumerate(value):
        if not (isinstance(item, list) and len(item) == 2 and all(_is_number(part) for part in item)):
            return [], f"Point {index + 1} must be a [latitude, longitude] pair of numbers."
        lat, lng = float(item[0]), float(item[1])
        if not (49 <= lat <= 61 and -9 <= lng <= 2.5):
            return [], f"Point {index + 1} is outside the area the data covers."
        points.append((lat, lng))
    return points, None


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


@router.post("/along-route", response_model=AlongRouteOut)
async def along_route(request: Request, service: HotspotService = Depends(get_hotspot_service)):
    store = _load(service)
    if isinstance(store, JSONResponse):
        return store
    try:
        raw = await request.json()
    except ValueError:
        raw = None
    if not isinstance(raw, dict):
        raise ApiValidationError({"body": "Send the route as a JSON object."})

    errors: dict[str, str] = {}
    if not store.is_v2:
        errors["file"] = NOT_IN_FILE
    path, problem = _parse_path(raw.get("path"))
    if problem:
        errors["path"] = problem
    buffer_m = raw.get("buffer_m", 200)
    if not _is_number(buffer_m) or not ROUTE_BUFFER[0] <= float(buffer_m) <= ROUTE_BUFFER[1]:
        errors["buffer_m"] = f"Enter a number from {ROUTE_BUFFER[0]} to {ROUTE_BUFFER[1]}."
    min_collisions = raw.get("min_collisions", 1)
    if not isinstance(min_collisions, int) or isinstance(min_collisions, bool) or min_collisions < 1:
        errors["min_collisions"] = "Enter a whole number, 1 or more."
    month = raw.get("month")
    if month is not None and (not isinstance(month, int) or isinstance(month, bool) or not 1 <= month <= 12):
        errors["month"] = "Enter a month from 1 to 12, or leave it out."
    slice_name = raw.get("slice", ALL_TIMES)
    if not isinstance(slice_name, str):
        errors["slice"] = BAD_OPTION
        slice_name = ALL_TIMES
    subset = raw.get("subset", "severe")
    persistence = raw.get("persistence", "any")
    if not isinstance(subset, str):
        errors["subset"] = BAD_OPTION
        subset = "severe"
    if not isinstance(persistence, str):
        errors["persistence"] = BAD_OPTION
        persistence = "any"
    filters, filter_errors = _read_filters(
        store, subset=subset, slice_name=slice_name, month=month if isinstance(month, int) else None,
        persistence=persistence, min_collisions=min_collisions if isinstance(min_collisions, int) else 1,
    )
    errors.update(filter_errors)
    if errors:
        raise ApiValidationError(errors)

    rows, distances, km, length_km = store.along_route(path, float(buffer_m), **filters)
    total = int(len(rows))
    summary_collisions = int(store.collisions[rows].sum()) if total else 0
    summary_fatal = int(store.fatal[rows].sum()) if total else 0
    per_10_km = round(summary_collisions / (length_km / 10), 2) if length_km > 0 else None
    chosen = slice(0, ROUTE_CAP)
    results = []
    for index, distance, along in zip(rows[chosen], distances[chosen], km[chosen]):
        item = store.row(int(index))
        item["km_from_start"] = round(float(along), 3)
        item["distance_from_route_m"] = round(float(distance), 1)
        results.append(item)
    return {
        "length_km": round(length_km, 3),
        "count": len(results),
        "truncated": total > ROUTE_CAP,
        "hotspots": results,
        "summary": {
            "hotspots": total,
            "collisions": summary_collisions,
            "fatal": summary_fatal,
            "per_10_km": per_10_km,
        },
    }

