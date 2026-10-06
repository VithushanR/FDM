"""The hotspot file contract. Used by the API at load time and by tools/validate_hotspots.py."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ValidationError, model_validator

UK_LAT = (49.0, 61.0)
UK_LON = (-9.0, 2.5)


class HotspotFileError(Exception):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("Hotspot file is malformed: " + "; ".join(problems))


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
