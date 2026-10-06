"""Request parsing and response shapes for the classification endpoints."""

import math
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, TypeAdapter, ValidationError

from ..services.features import FORM_FIELDS
from ..services.model_service import BAD_OPTION


def _reject_bool(value: Any) -> Any:
    # Python's bool is an int subclass. A checkbox value of true must not pass as 1 vehicle.
    if isinstance(value, bool):
        raise ValueError("booleans are not numbers")
    return value


WholeNumber = Annotated[int | None, BeforeValidator(_reject_bool)]
Decimal = Annotated[float | None, BeforeValidator(_reject_bool)]
# Dropdown values can arrive as "6" or 6, so both are accepted and normalised later.
CodeValue = Annotated[str | int | float | None, BeforeValidator(_reject_bool)]

# The type each form field kind must have. Field types are read from the form definition.
KIND_TYPES: dict[str, Any] = {
    "date": str | None,
    "time": str | None,
    "select": CodeValue,
    "integer": WholeNumber,
    "decimal": Decimal,
    "text": str | None,
    "multicheck": list[str] | None,
}
FRIENDLY_TYPE_ERRORS = {
    "date": "Enter a valid date.",
    "time": "Enter a valid time, for example 18:30.",
    "select": BAD_OPTION,
    "integer": "Enter a whole number.",
    "decimal": "Enter a number.",
    "text": "Enter driver ages as whole numbers from 1 to 105, separated by commas, for example 34, 52.",
    "multicheck": BAD_OPTION,
}
_ADAPTERS = {spec.name: (TypeAdapter(KIND_TYPES[spec.kind]), spec.kind) for spec in FORM_FIELDS}
_ADAPTERS_LOCATION = TypeAdapter(Decimal)


def parse_form(raw: Any) -> tuple[dict[str, Any], dict[str, str]]:
    """Type-check each field on its own so every bad field is reported together. Returns (values, errors)."""
    if not isinstance(raw, dict):
        return {}, {"body": "Send the form as a JSON object."}
    values: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for name, (adapter, kind) in _ADAPTERS.items():
        try:
            values[name] = adapter.validate_python(raw.get(name))
        except ValidationError:
            errors[name] = FRIENDLY_TYPE_ERRORS[kind]
    return values, errors


def location_range_errors(latitude: float | None, longitude: float | None) -> dict[str, str]:
    """The numeric range check, so a point outside the UK box is refused before the coverage check runs."""
    errors: dict[str, str] = {}
    specs = {spec.name: spec for spec in FORM_FIELDS if spec.name in ("latitude", "longitude")}
    for name, value in (("latitude", latitude), ("longitude", longitude)):
        if value is None:
            continue
        spec = specs[name]
        if not math.isfinite(value) or not spec.min <= value <= spec.max:
            errors[name] = f"Enter a number from {spec.min:g} to {spec.max:g}."
    return errors


def parse_location(raw: Any) -> tuple[float | None, float | None, dict[str, str]]:
    """Body of POST /api/location/check: both numbers are required and must be inside the box."""
    if not isinstance(raw, dict):
        return None, None, {"body": "Send the location as a JSON object."}
    values, errors = {}, {}
    for name in ("latitude", "longitude"):
        if raw.get(name) is None:
            errors[name] = "This field is required."
            continue
        try:
            values[name] = _ADAPTERS_LOCATION.validate_python(raw[name])
        except ValidationError:
            errors[name] = FRIENDLY_TYPE_ERRORS["decimal"]
    if not errors:
        errors.update(location_range_errors(values["latitude"], values["longitude"]))
    return values.get("latitude"), values.get("longitude"), errors


class HealthOk(BaseModel):
    status: Literal["ok"]
    model: str
    demo: bool
    warnings: list[str]
    coverage_grid: str


class LocationOut(BaseModel):
    status: Literal["covered", "sparse", "outside", "unchecked"]
    nearest_km: float | None


class LocationCheckResponse(BaseModel):
    status: Literal["covered", "sparse", "outside", "unchecked"]
    nearest_km: float | None
    message: str | None
    allowed: bool


class PredictResponse(BaseModel):
    severity_code: int
    severity: str
    scores: dict[str, float]
    adjusted_scores: dict[str, float]
    score_kind: Literal["probability", "score"]
    fatal_adjust: float
    adjust_mode: str
    adjustment_note: str
    left_blank: list[str]
    warnings: list[str]
    location: LocationOut | None


class FieldOption(BaseModel):
    value: str
    label: str


class FormField(BaseModel):
    name: str
    label: str
    kind: str
    required: bool
    help: str | None
    options: list[FieldOption]
    min: float | None
    max: float | None
    placeholder: str | None


class FormGroup(BaseModel):
    title: str
    fields: list[FormField]
    widget: str | None = None


class SchemaResponse(BaseModel):
    loaded: Literal[True]
    demo: bool
    model_name: str
    classes: dict[str, str]
    score_kind: Literal["probability", "score"]
    adjust_mode: str
    fatal_adjust: float
    performance: dict[str, Any]
    warnings: list[str]
    groups: list[FormGroup]
