"""Form answers to model input columns. Every derivation formula lives here."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date, time

import numpy as np

NAN = float("nan")

NUMERIC_COLUMNS = (
    "speed_limit", "latitude", "longitude", "number_of_vehicles",
    "min_driver_age", "max_driver_age", "avg_driver_age", "vehicle_type_diversity",
    "month_sin", "month_cos", "hour_of_day_sin", "hour_of_day_cos",
)
# Categorical unless the model passes the column through as a number. OPTIONAL_ENCODING lists the columns
# where the model may do either, so a missing one-hot encoder is not a load error for them.
OPTIONAL_ENCODING = frozenset({"trunk_road_flag"})
CATEGORICAL_COLUMNS = (
    "road_type", "first_road_class", "trunk_road_flag", "junction_detail", "junction_control",
    "pedestrian_crossing", "urban_or_rural_area", "weather_conditions", "light_conditions",
    "road_surface_conditions", "special_conditions_at_site", "carriageway_hazards", "day_of_week",
    "season", "time_of_day_bucket",
)
FLAG_COLUMNS = (
    "is_weekend", "has_car", "has_motorcycle", "has_hgv", "has_bus_or_coach",
    "has_van_or_goods_light", "has_pedal_cycle", "has_other", "has_undocumented_code_33",
)
MODEL_COLUMNS = NUMERIC_COLUMNS + CATEGORICAL_COLUMNS + FLAG_COLUMNS

# Values a model must never take as input. Any casualty flag is also leakage.
LEAKAGE_COLUMNS = frozenset({
    "worst_casualty_severity", "pedestrian_involved", "enhanced_severity_collision",
    "collision_severity", "number_of_casualties",
})
LEAKAGE_PATTERN = re.compile(r"^has_.*_casualty$")

SEASONS = ("Winter", "Spring", "Summer", "Autumn")
TIME_BUCKETS = ("Night", "Morning Rush", "Midday", "Evening Rush", "Evening")
DAY_OF_WEEK_VALUES = tuple(range(1, 8))  # STATS19: 1 = Sunday ... 7 = Saturday

# (form key, label, model column). Each form key is one vehicle type that was ticked.
VEHICLE_TYPES = (
    ("car", "Car or taxi", "has_car"),
    ("motorcycle", "Motorcycle", "has_motorcycle"),
    ("pedal_cycle", "Pedal cycle", "has_pedal_cycle"),
    ("bus_or_coach", "Bus, coach or minibus", "has_bus_or_coach"),
    ("van_or_goods_light", "Van or light goods vehicle", "has_van_or_goods_light"),
    ("hgv", "Heavy goods vehicle (over 3.5 tonnes)", "has_hgv"),
    ("other", "Other (horse, tram, tractor, mobility scooter...)", "has_other"),
)
VEHICLE_COLUMNS = tuple(column for _, _, column in VEHICLE_TYPES) + ("has_undocumented_code_33",)

SPEED_OPTIONS = tuple((str(s), f"{s} mph") for s in (20, 30, 40, 50, 60, 70))
MAX_VEHICLES = 30
MAX_AGE = 105


@dataclass(frozen=True)
class FieldSpec:
    """One form field. columns are the model inputs it feeds; the field is only shown if the model uses one."""

    name: str
    label: str
    kind: str  # date | time | select | integer | decimal | text | multicheck
    group: str
    columns: tuple[str, ...]
    required: bool = False
    help: str | None = None
    placeholder: str | None = None
    min: float | None = None
    max: float | None = None
    static_options: tuple[tuple[str, str], ...] = ()
    # True for a select whose options come from the fitted encoder, not from this file
    dynamic_options: bool = False


WHEN, ROAD, CONDITIONS, VEHICLES_GROUP, LOCATION = (
    "When", "Road", "Conditions", "Vehicles and drivers", "Location",
)

FORM_FIELDS: tuple[FieldSpec, ...] = (
    FieldSpec("date", "Date", "date", WHEN,
              ("day_of_week", "is_weekend", "month_sin", "month_cos", "season"),
              required=True, placeholder="yyyy-mm-dd"),
    FieldSpec("time", "Time", "time", WHEN,
              ("hour_of_day_sin", "hour_of_day_cos", "time_of_day_bucket"),
              required=True, placeholder="HH:MM"),
    FieldSpec("road_type", "Road layout", "select", ROAD, ("road_type",), required=True, dynamic_options=True),
    FieldSpec("first_road_class", "Road class", "select", ROAD, ("first_road_class",), dynamic_options=True),
    FieldSpec("trunk_road_flag", "Trunk road", "select", ROAD, ("trunk_road_flag",), dynamic_options=True),
    FieldSpec("speed_limit", "Speed limit", "select", ROAD, ("speed_limit",), required=True,
              static_options=SPEED_OPTIONS),
    FieldSpec("urban_or_rural_area", "Area type", "select", ROAD, ("urban_or_rural_area",),
              required=True, dynamic_options=True),
    FieldSpec("junction_detail", "Junction", "select", ROAD, ("junction_detail",),
              required=True, dynamic_options=True),
    FieldSpec("junction_control", "Junction control", "select", ROAD, ("junction_control",),
              dynamic_options=True),
    FieldSpec("pedestrian_crossing", "Pedestrian crossing", "select", ROAD, ("pedestrian_crossing",),
              dynamic_options=True),
    FieldSpec("light_conditions", "Lighting", "select", CONDITIONS, ("light_conditions",),
              required=True, dynamic_options=True),
    FieldSpec("weather_conditions", "Weather", "select", CONDITIONS, ("weather_conditions",),
              required=True, dynamic_options=True),
    FieldSpec("road_surface_conditions", "Road surface", "select", CONDITIONS, ("road_surface_conditions",),
              required=True, dynamic_options=True),
    FieldSpec("special_conditions_at_site", "Special site conditions", "select", CONDITIONS,
              ("special_conditions_at_site",), dynamic_options=True),
    FieldSpec("carriageway_hazards", "Hazard on the carriageway", "select", CONDITIONS,
              ("carriageway_hazards",), dynamic_options=True),
    FieldSpec("number_of_vehicles", "Number of vehicles", "integer", VEHICLES_GROUP,
              ("number_of_vehicles",), required=True, min=1, max=MAX_VEHICLES),
    FieldSpec("vehicles", "Types of vehicle involved", "multicheck", VEHICLES_GROUP,
              tuple(column for _, _, column in VEHICLE_TYPES) + ("vehicle_type_diversity",),
              required=True, help="Tick every type that was involved.",
              static_options=tuple((key, label) for key, label, _ in VEHICLE_TYPES)),
    FieldSpec("driver_ages", "Driver ages", "text", VEHICLES_GROUP,
              ("min_driver_age", "max_driver_age", "avg_driver_age"),
              help="Whole numbers separated by commas, for example 34, 52.", placeholder="34, 52"),
    FieldSpec("latitude", "Latitude", "decimal", LOCATION, ("latitude",), min=49, max=61,
              help="Decimal degrees, for example 51.5072."),
    FieldSpec("longitude", "Longitude", "decimal", LOCATION, ("longitude",), min=-9, max=2.5,
              help="Decimal degrees, for example -0.1276."),
)

# Groups that the frontend draws with a special control, e.g. a map picker for Location.
GROUP_WIDGETS = {LOCATION: "location"}

CATEGORY_FIELDS = tuple(f.name for f in FORM_FIELDS if f.kind == "select" and f.dynamic_options)


def normalise_code(value) -> str | None:
    """Turn 6, 6.0, np.int64(6) and "6" into "6". Blank and NaN become None; text is kept as it is."""
    if value is None:
        return None
    if isinstance(value, (float, np.floating)) and math.isnan(value):
        return None
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    if isinstance(value, (float, np.floating)):
        return str(int(value)) if float(value).is_integer() else str(float(value))
    text = str(value).strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return text
    if math.isnan(number):
        return None
    return str(int(number)) if number.is_integer() else str(number)


DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_PATTERN = re.compile(r"^\d{2}:\d{2}$")


def parse_date(text: str) -> date | None:
    if not DATE_PATTERN.match(text.strip()):
        return None
    try:
        return date.fromisoformat(text.strip())
    except ValueError:
        return None


def parse_time(text: str) -> time | None:
    value = text.strip()
    if not TIME_PATTERN.match(value):
        return None
    hour, minute = int(value[:2]), int(value[3:])
    if hour > 23 or minute > 59:
        return None
    return time(hour, minute)


def day_of_week(day: date) -> int:
    """STATS19 coding: 1 = Sunday ... 7 = Saturday. Python's weekday() has Monday = 0."""
    return ((day.weekday() + 1) % 7) + 1


def month_sin_cos(month: int) -> tuple[float, float]:
    angle = 2 * math.pi * month / 12
    return math.sin(angle), math.cos(angle)


def hour_sin_cos(hour: int) -> tuple[float, float]:
    angle = 2 * math.pi * hour / 24
    return math.sin(angle), math.cos(angle)


def season_for_month(month: int) -> str:
    if month in (12, 1, 2):
        return "Winter"
    if month in (3, 4, 5):
        return "Spring"
    if month in (6, 7, 8):
        return "Summer"
    return "Autumn"


def time_bucket_for_hour(hour: int) -> str:
    if hour <= 5:
        return "Night"
    if hour <= 9:
        return "Morning Rush"
    if hour <= 15:
        return "Midday"
    if hour <= 18:
        return "Evening Rush"
    return "Evening"


def build_row(answers: dict) -> dict[str, object]:
    """Answers from the validated form to one raw value per model column. Missing values are NaN."""
    row: dict[str, object] = {column: NAN for column in MODEL_COLUMNS}

    day = answers.get("date")
    if day is not None:
        dow = day_of_week(day)
        row["day_of_week"] = dow
        row["is_weekend"] = int(dow in (1, 7))
        row["month_sin"], row["month_cos"] = month_sin_cos(day.month)
        row["season"] = season_for_month(day.month)

    clock = answers.get("time")
    if clock is not None:
        row["hour_of_day_sin"], row["hour_of_day_cos"] = hour_sin_cos(clock.hour)
        row["time_of_day_bucket"] = time_bucket_for_hour(clock.hour)

    for name in CATEGORY_FIELDS:
        if answers.get(name) is not None:
            row[name] = answers[name]

    if answers.get("speed_limit") is not None:
        row["speed_limit"] = float(answers["speed_limit"])
    if answers.get("number_of_vehicles") is not None:
        row["number_of_vehicles"] = answers["number_of_vehicles"]
    if answers.get("latitude") is not None:
        row["latitude"] = answers["latitude"]
    if answers.get("longitude") is not None:
        row["longitude"] = answers["longitude"]

    ticked = answers.get("vehicles")
    if ticked is not None:
        ticked_set = set(ticked)
        for key, _, column in VEHICLE_TYPES:
            row[column] = int(key in ticked_set)
        row["vehicle_type_diversity"] = len(ticked_set)
        # Undocumented code 33 is never set by the form.
        row["has_undocumented_code_33"] = 0

    ages = answers.get("driver_ages")
    if ages:
        row["min_driver_age"] = min(ages)
        row["max_driver_age"] = max(ages)
        row["avg_driver_age"] = sum(ages) / len(ages)

    return row
