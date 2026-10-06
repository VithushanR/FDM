"""Checks whether a location is near collision data, using the coverage grid built by tools/build_coverage_grid.py.

The grid stores the centres of the occupied cells. The distance to the nearest centre is measured with a
haversine BallTree. Cells are about 1.1 km by 0.65 km, so the distance is accurate to roughly 0.7 km.
Without a grid the service falls back to the coarse box and reports "unchecked" for points inside it.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from fastapi import Request
from sklearn.neighbors import BallTree

# The coarse box also covers Ireland and Northern Ireland. The grid is what excludes them.
BOX_LATITUDE = (49.0, 61.0)
BOX_LONGITUDE = (-9.0, 2.5)
EARTH_RADIUS_KM = 6371.0088
SPARSE_MESSAGE = (
    "There is little recorded collision data near this location (the nearest is {km:.1f} km away), "
    "so the estimate relies on the rest of the data."
)
OUTSIDE_MESSAGE = (
    "This location is more than {km:g} km from any collision in the data. "
    "The data covers Great Britain only (England, Scotland and Wales)."
)
FALLBACK_WARNING = (
    "Coverage grid not built: locations are checked against a coarse box that includes Ireland and Northern Ireland."
)


class CoverageService:
    def __init__(self, path: Path, thresholds: dict):
        self.path = path
        self.warnings: list[str] = []
        self.tree: BallTree | None = None
        self.cells = 0
        self.sparse_km = float(thresholds.get("sparse_km", 3))
        self.outside_km = float(thresholds.get("outside_km", 10))
        if not 0 < self.sparse_km < self.outside_km:
            self.warnings.append("location thresholds in model_config.json must satisfy 0 < sparse_km < outside_km.")
            return
        if not path.exists():
            self.warnings.append(FALLBACK_WARNING)
            return
        try:
            with np.load(path) as data:
                latitudes = data["centre_latitude"].astype(np.float64)
                longitudes = data["centre_longitude"].astype(np.float64)
        except Exception as exc:  # a damaged grid must not stop the app from starting
            self.warnings.append(f"Coverage grid could not be read ({exc}). {FALLBACK_WARNING}")
            return
        if latitudes.size == 0 or latitudes.shape != longitudes.shape:
            self.warnings.append(f"Coverage grid {path.name} has no usable cells. {FALLBACK_WARNING}")
            return
        self.tree = BallTree(np.radians(np.column_stack([latitudes, longitudes])), metric="haversine")
        self.cells = int(latitudes.size)

    @property
    def loaded(self) -> bool:
        return self.tree is not None

    def health_text(self) -> str:
        return f"loaded ({self.cells} cells)" if self.loaded else "missing"

    def check(self, latitude: float, longitude: float) -> dict:
        if not self.loaded:
            return self._box_check(latitude, longitude)
        distance, _ = self.tree.query(np.radians([[latitude, longitude]]), k=1)
        km = float(distance[0, 0]) * EARTH_RADIUS_KM
        if km <= self.sparse_km:
            return {"status": "covered", "nearest_km": round(km, 2), "message": None, "allowed": True}
        if km <= self.outside_km:
            return {
                "status": "sparse",
                "nearest_km": round(km, 2),
                "message": SPARSE_MESSAGE.format(km=km),
                "allowed": True,
            }
        return {
            "status": "outside",
            "nearest_km": round(km, 2),
            "message": OUTSIDE_MESSAGE.format(km=self.outside_km),
            "allowed": False,
        }

    def _box_check(self, latitude: float, longitude: float) -> dict:
        inside = BOX_LATITUDE[0] <= latitude <= BOX_LATITUDE[1] and BOX_LONGITUDE[0] <= longitude <= BOX_LONGITUDE[1]
        if inside:
            return {"status": "unchecked", "nearest_km": None, "message": None, "allowed": True}
        return {
            "status": "outside",
            "nearest_km": None,
            "message": OUTSIDE_MESSAGE.format(km=self.outside_km),
            "allowed": False,
        }


def get_coverage_service(request: Request) -> CoverageService:
    return request.app.state.coverage
