"""The hotspot file contracts (versions 1 and 2), the profile file, and the response shapes of the hotspot endpoints.

Version 1 is validated with pydantic, as before. Version 2 has about 70,000 rows, so it is checked with a plain
loop over the rows, which keeps startup fast. Both paths report every problem, not just the first.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

UK_LAT = (49.0, 61.0)
UK_LON = (-9.0, 2.5)
ALL_TIMES = "All times"
PERSISTENCE_LABELS = ("Persistent", "Recent", "Fading", "Mixed", "Too few to judge")
# The API's persistence values, mapped to the labels stored in the file.
PERSISTENCE_PARAMS = {
    "any": None,
    "persistent": "Persistent",
    "recent": "Recent",
    "fading": "Fading",
    "mixed": "Mixed",
    "too_few": "Too few to judge",
}
YEARS = (2021, 2022, 2023, 2024, 2025)
SHARE_KEYS = ("motorcycle", "pedal_cycle", "hgv", "pedestrian", "dark", "wet_icy", "junction", "rural")
TOO_FEW_BELOW = 8


class HotspotFileError(Exception):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("Hotspot file is malformed: " + "; ".join(problems))


# Version 1

class Hotspot(BaseModel):
    id: int
    subset: str
    slice: str
    latitude: float
    longitude: float
    radius_m: float
    collisions: int
    fatal: int
    serious: int
    slight: int
    label: str | None = None

    @model_validator(mode="after")
    def _check_counts_and_place(self):
        total = self.fatal + self.serious + self.slight
        if self.collisions != total:
            raise ValueError(f"collisions ({self.collisions}) must equal fatal + serious + slight ({total})")
        if min(self.fatal, self.serious, self.slight) < 0:
            raise ValueError("fatal, serious and slight counts cannot be negative")
        if not UK_LAT[0] <= self.latitude <= UK_LAT[1] or not UK_LON[0] <= self.longitude <= UK_LON[1]:
            raise ValueError(f"coordinates ({self.latitude}, {self.longitude}) are outside the UK bounds")
        if self.radius_m <= 0:
            raise ValueError("radius_m must be greater than 0")
        # "severe" means Fatal and Serious only, so a severe hotspot cannot count Slight collisions.
        if self.subset == "severe" and self.slight != 0:
            raise ValueError("a severe hotspot cannot count Slight collisions")
        return self


class HotspotFile(BaseModel):
    version: Literal[1]
    generated_at: datetime
    method: str
    parameters: dict[str, Any]
    subsets: list[str]
    slices: list[str]
    hotspots: list[Hotspot]


def _format_location(loc: tuple) -> str:
    text = ""
    for part in loc:
        if isinstance(part, int):
            text += f"[{part}]"
        else:
            text += f".{part}" if text else str(part)
    return text or "file"


def _extra_problems(data: Any) -> list[str]:
    """Checks that need the top-level lists. Run on the raw data so every problem is reported, not just the first."""
    if not isinstance(data, dict):
        return []
    subsets, slices = data.get("subsets"), data.get("slices")
    hotspots = data.get("hotspots")
    if not isinstance(hotspots, list):
        return []
    problems = []
    seen_ids: list[Any] = []  # a list, so an unhashable id is reported instead of crashing
    for index, item in enumerate(hotspots):
        if not isinstance(item, dict):
            continue
        if isinstance(subsets, list) and item.get("subset") not in subsets:
            problems.append(f"hotspots[{index}]: subset {item.get('subset')!r} is not listed in subsets")
        if isinstance(slices, list) and item.get("slice") not in slices:
            problems.append(f"hotspots[{index}]: slice {item.get('slice')!r} is not listed in slices")
        if item.get("id") in seen_ids:
            problems.append(f"hotspots[{index}]: duplicate id {item.get('id')}")
        seen_ids.append(item.get("id"))
    return problems


def parse_hotspot_data(data: Any) -> HotspotFile:
    """Version 1 only. Kept as it was, so the version 1 tests and tools still hold."""
    problems: list[str] = []
    try:
        parsed = HotspotFile.model_validate(data)
    except ValidationError as exc:
        for error in exc.errors():
            message = error["msg"].removeprefix("Value error, ")
            problems.append(f"{_format_location(error['loc'])}: {message}")
    problems += _extra_problems(data)
    if problems:
        raise HotspotFileError(problems)
    return parsed


# Version 2

REQUIRED_V2 = (
    "id", "subset", "slice", "month", "latitude", "longitude", "radius_m", "collisions", "fatal",
    "serious", "slight", "label", "years_present", "persistence",
)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_v2(data: Any) -> list[str]:
    """Every problem in a version 2 hotspot file, one string each. An empty list means it is valid."""
    if not isinstance(data, dict):
        return ["file: the top level must be a JSON object"]
    missing = [key for key in ("generated_at", "method", "parameters", "subsets", "slices", "months",
                               "persistence_labels", "features", "hotspots") if key not in data]
    if missing:
        return [f"file: missing {', '.join(missing)}"]
    problems: list[str] = []
    if data.get("version") != 2:
        problems.append("file: version must be 2")
    subsets, slices = data["subsets"], data["slices"]
    if not isinstance(subsets, list) or not set(subsets) <= {"all", "severe"}:
        problems.append("file: subsets must be a list of 'all' and 'severe'")
    if not isinstance(slices, list) or ALL_TIMES not in slices:
        problems.append(f"file: slices must be a list that includes {ALL_TIMES!r}")
    if not isinstance(data["hotspots"], list):
        return problems + ["file: hotspots must be a list"]
    labels = data["persistence_labels"]
    if not isinstance(labels, list) or not set(labels) <= set(PERSISTENCE_LABELS):
        problems.append("file: persistence_labels must use the five labels")

    for index, row in enumerate(data["hotspots"]):
        where = f"hotspots[{index}]"
        if not isinstance(row, dict):
            problems.append(f"{where}: must be an object")
            continue
        absent = [key for key in REQUIRED_V2 if key not in row]
        if absent:
            problems.append(f"{where}: missing {', '.join(absent)}")
            continue
        if row["id"] != index + 1:
            problems.append(f"{where}: id {row['id']} should be {index + 1} (ids run 1 to N in order)")
        if row["subset"] not in subsets:
            problems.append(f"{where}: subset {row['subset']!r} is not listed in subsets")
        if row["slice"] not in slices:
            problems.append(f"{where}: slice {row['slice']!r} is not listed in slices")
        month = row["month"]
        if month is not None and (not _is_int(month) or not 1 <= month <= 12):
            problems.append(f"{where}: month must be null or 1 to 12")
        elif month is not None and row["slice"] != ALL_TIMES:
            problems.append(f"{where}: a month row must have slice {ALL_TIMES!r}")
        if not _is_number(row["latitude"]) or not _is_number(row["longitude"]) or not (
            UK_LAT[0] <= row["latitude"] <= UK_LAT[1] and UK_LON[0] <= row["longitude"] <= UK_LON[1]
        ):
            problems.append(f"{where}: coordinates are outside the UK bounds")
        if not _is_number(row["radius_m"]) or not 1 <= row["radius_m"] <= 500:
            problems.append(f"{where}: radius_m must be 1 to 500")
        counts = [row["collisions"], row["fatal"], row["serious"], row["slight"]]
        if not all(_is_int(value) and value >= 0 for value in counts):
            problems.append(f"{where}: collision counts must be whole numbers, 0 or more")
            continue
        if row["collisions"] != row["fatal"] + row["serious"] + row["slight"]:
            problems.append(
                f"{where}: collisions ({row['collisions']}) must equal fatal + serious + slight "
                f"({row['fatal'] + row['serious'] + row['slight']})"
            )
        if row["subset"] == "severe" and row["slight"] != 0:
            problems.append(f"{where}: a severe hotspot cannot count Slight collisions")
        if not _is_int(row["years_present"]) or not 0 <= row["years_present"] <= 5:
            problems.append(f"{where}: years_present must be 0 to 5")
        if row["label"] is not None and not isinstance(row["label"], str):
            problems.append(f"{where}: label must be a string or null")
        if row["persistence"] not in PERSISTENCE_LABELS:
            problems.append(f"{where}: persistence {row['persistence']!r} is not one of the five labels")
    return problems


def validate_profiles(profiles: Any, hotspots: list[dict[str, Any]]) -> list[str]:
    """Every problem in the profile file, checked against the hotspot rows. Rows must already pass validate_v2."""
    if not isinstance(profiles, dict):
        return ["profiles: the top level must be a JSON object"]
    problems: list[str] = []
    if profiles.get("version") != 2:
        problems.append("profiles: version must be 2")
    if list(profiles.get("years", [])) != list(YEARS):
        problems.append("profiles: years must be 2021 to 2025")
    if list(profiles.get("months", [])) != list(range(1, 13)):
        problems.append("profiles: months must be 1 to 12")
    time_slices = profiles.get("time_slices", [])
    if not isinstance(time_slices, list) or len(time_slices) != 5 or ALL_TIMES in time_slices:
        problems.append("profiles: time_slices must be the five time-of-day names")
    if list(profiles.get("share_keys", [])) != list(SHARE_KEYS):
        problems.append("profiles: share_keys must be the eight keys in the agreed order")
    entries = profiles.get("profiles")
    if not isinstance(entries, dict):
        return problems + ["profiles: profiles must be an object keyed by hotspot id"]
    if set(entries) != {str(row["id"]) for row in hotspots}:
        problems.append("profiles: there must be exactly one profile for every hotspot id")

    for row in hotspots:
        key = str(row["id"])
        profile = entries.get(key)
        if profile is None:
            continue
        where = f"profiles[{key}]"
        try:
            y, m, t, s = profile["y"], profile["m"], profile["t"], profile["s"]
        except (KeyError, TypeError):
            problems.append(f"{where}: needs y, m, t and s")
            continue
        collisions = row["collisions"]
        if len(y) != 5 or len(m) != 12 or len(t) != 5 or len(s) != 8:
            problems.append(f"{where}: y needs 5 values, m 12, t 5 and s 8")
            continue
        if sum(y) != collisions:
            problems.append(f"{where}: the years add up to {sum(y)}, not {collisions}")
        if sum(m) != collisions:
            problems.append(f"{where}: the months add up to {sum(m)}, not {collisions}")
        if sum(t) != collisions:
            problems.append(f"{where}: the time of day adds up to {sum(t)}, not {collisions}")
        if any(value > collisions for value in s):
            problems.append(f"{where}: a share count is larger than the collisions")
        years_present = sum(1 for value in y if value > 0)
        if years_present != row["years_present"]:
            problems.append(f"{where}: years_present is {row['years_present']} but the profile has {years_present} years")
        too_few = collisions < TOO_FEW_BELOW
        if too_few != (row["persistence"] == "Too few to judge"):
            problems.append(f"{where}: 'Too few to judge' must be used exactly when collisions are under {TOO_FEW_BELOW}")
        if row["persistence"] == "Persistent" and row["years_present"] < 4:
            problems.append(f"{where}: 'Persistent' needs collisions in at least 4 years")
        if row["month"] is not None and m[row["month"] - 1] != collisions:
            problems.append(f"{where}: a month {row['month']} hotspot must have all its collisions in that month")
    return problems


def parse_hotspot_v2(data: Any, profiles: Any = None) -> dict[str, Any]:
    """Validates a version 2 file, and its profiles when given. Returns the raw data or raises HotspotFileError."""
    problems = validate_v2(data)
    if not problems and profiles is not None:
        problems += validate_profiles(profiles, data["hotspots"])
    if problems:
        raise HotspotFileError(problems)
    return data


def load_hotspot_raw(data: Any) -> Literal[1, 2]:
    """Which version a raw file is. Anything else is a problem the caller reports."""
    version = data.get("version") if isinstance(data, dict) else None
    if version not in (1, 2):
        raise HotspotFileError(["file: version must be 1 or 2"])
    return version


# Response shapes. They document the API and are used as response models.

class HotspotOut(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {
        "id": 9031, "subset": "severe", "slice": "Evening Rush", "month": None,
        "latitude": 51.514775, "longitude": -0.141966, "radius_m": 280, "collisions": 18,
        "fatal": 0, "serious": 18, "slight": 0, "label": "LSOA E01033595",
        "years_present": 4, "persistence": "Persistent",
    }})
    id: int
    subset: str
    slice: str
    month: int | None = None
    latitude: float
    longitude: float
    radius_m: float
    collisions: int
    fatal: int
    serious: int
    slight: int
    label: str | None = None
    years_present: int | None = None
    persistence: str | None = None


class HotspotListOut(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {
        "count": 3, "subset": "severe", "slice": "All times", "total_matched": 3895, "truncated": True,
        "hotspots": [],
    }})
    count: int
    subset: str
    slice: str
    total_matched: int
    truncated: bool
    hotspots: list[HotspotOut]


class CountsOut(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"collisions": 967, "fatal": 154, "severe": 967}})
    collisions: int = Field(description="Every hotspot that matches the filters")
    fatal: int = Field(description="Those with at least one Fatal collision")
    severe: int = Field(description="Those with at least one Fatal or Serious collision")


class NearbyOut(HotspotOut):
    distance_m: int
    busiest_time: str | None = Field(None, description="Time of day with the most collisions, or null without profiles")


class NearbyListOut(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"count": 1, "radius_m": 500, "hotspots": []}})
    count: int
    radius_m: int
    hotspots: list[NearbyOut]


class RouteHotspotOut(HotspotOut):
    km_from_start: float
    distance_from_route_m: float


class RouteSummary(BaseModel):
    hotspots: int
    collisions: int
    fatal: int
    per_10_km: float | None


class AlongRouteOut(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {
        "length_km": 4.2, "count": 2, "truncated": False, "hotspots": [],
        "summary": {"hotspots": 2, "collisions": 40, "fatal": 1, "per_10_km": 95.2},
    }})
    length_km: float
    count: int
    truncated: bool
    hotspots: list[RouteHotspotOut]
    summary: RouteSummary


class ProfileYear(BaseModel):
    year: int
    collisions: int


class ProfileMonth(BaseModel):
    month: int
    collisions: int


class ProfileSlice(BaseModel):
    slice: str
    collisions: int


class ProfileShare(BaseModel):
    key: str
    label: str
    count: int
    here_pct: float
    gb_pct: float


class ProfileOut(BaseModel):
    years: list[ProfileYear]
    months: list[ProfileMonth]
    time_of_day: list[ProfileSlice]
    shares: list[ProfileShare]
    baseline_subset: str


class PersistenceOut(BaseModel):
    label: str | None
    years_present: int | None
    rules: dict[str, str]


class DetailsOut(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {
        "hotspot": {"id": 1}, "profile": {"years": [], "months": [], "time_of_day": [], "shares": [],
                                          "baseline_subset": "all"},
        "persistence": {"label": "Persistent", "years_present": 5, "rules": {}},
    }})
    hotspot: HotspotOut
    profile: ProfileOut
    persistence: PersistenceOut
