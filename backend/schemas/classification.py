"""Request parsing and response shapes for the classification endpoints."""

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


class HealthOk(BaseModel):
    status: Literal["ok"]
    model: str
    demo: bool
    warnings: list[str]


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
