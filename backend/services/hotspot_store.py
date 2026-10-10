"""The hotspots as numpy arrays, one array per field, and the profiles as arrays indexed by id.

Every query first narrows the rows with a latitude band (a sorted index and searchsorted), then applies the exact
filters to the few rows left. Nothing here knows about HTTP.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ..schemas.hotspots import HotspotFile, validate_profiles

METRES_PER_DEGREE_LAT = 111_195.0
EARTH_RADIUS_M = 6_371_008.8


def haversine_m(lat1: Any, lon1: Any, lat2: Any, lon2: Any) -> np.ndarray:
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi = phi2 - phi1
    dlambda = np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin(dphi / 2) ** 2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


@dataclass
class HotspotStore:
    version: int
    generated_at: str
    method: str
    parameters: dict[str, Any]
    subsets: list[str]
    slices: list[str]
    months: list[str] | None
    persistence_labels: list[str] | None
    count: int
    ids: np.ndarray
    subset_idx: np.ndarray
    slice_idx: np.ndarray
    month: np.ndarray  # 0 means no month (the All times and time-of-day rows)
    lat: np.ndarray
    lon: np.ndarray
    radius: np.ndarray
    collisions: np.ndarray
    fatal: np.ndarray
    serious: np.ndarray
    slight: np.ndarray
    years_present: np.ndarray  # -1 in version 1 files, which do not record it
    persistence_idx: np.ndarray  # -1 in version 1 files
    labels: list[str | None] = field(repr=False)
    by_lat: np.ndarray = field(repr=False)
    lat_sorted: np.ndarray = field(repr=False)

    @property
    def is_v2(self) -> bool:
        return self.version == 2

    @classmethod
    def from_v1(cls, model: HotspotFile) -> HotspotStore:
        rows = model.hotspots
        subsets, slices = list(model.subsets), list(model.slices)
        return cls._build(
            version=1, generated_at=model.generated_at.isoformat(), method=model.method,
            parameters=model.parameters, subsets=subsets, slices=slices, months=None,
            persistence_labels=None, rows=[
                (r.id, subsets.index(r.subset), slices.index(r.slice), 0, r.latitude, r.longitude, r.radius_m,
                 r.collisions, r.fatal, r.serious, r.slight, -1, -1, r.label)
                for r in rows
            ],
        )

    @classmethod
    def from_v2(cls, raw: dict[str, Any]) -> HotspotStore:
        subsets, slices = list(raw["subsets"]), list(raw["slices"])
        labels_list = list(raw["persistence_labels"])
        rows = [
            (r["id"], subsets.index(r["subset"]), slices.index(r["slice"]), r["month"] or 0,
             r["latitude"], r["longitude"], r["radius_m"], r["collisions"], r["fatal"], r["serious"], r["slight"],
             r["years_present"], labels_list.index(r["persistence"]), r["label"])
            for r in raw["hotspots"]
        ]
        return cls._build(
            version=2, generated_at=raw["generated_at"], method=raw["method"], parameters=raw["parameters"],
            subsets=subsets, slices=slices, months=list(raw["months"]), persistence_labels=labels_list, rows=rows,
        )

    @classmethod
    def _build(cls, *, version, generated_at, method, parameters, subsets, slices, months, persistence_labels, rows):
        columns = list(zip(*rows)) if rows else [[] for _ in range(14)]

        def arr(index: int, dtype) -> np.ndarray:
            return np.asarray(columns[index], dtype=dtype)

        lat = arr(4, np.float64)
        by_lat = np.argsort(lat, kind="stable")
        return cls(
            version=version, generated_at=generated_at, method=method, parameters=parameters,
            subsets=subsets, slices=slices, months=months, persistence_labels=persistence_labels,
            count=len(rows),
            ids=arr(0, np.int64), subset_idx=arr(1, np.int16), slice_idx=arr(2, np.int16), month=arr(3, np.int16),
            lat=lat, lon=arr(5, np.float64), radius=arr(6, np.float64), collisions=arr(7, np.int64),
            fatal=arr(8, np.int64), serious=arr(9, np.int64), slight=arr(10, np.int64),
            years_present=arr(11, np.int16), persistence_idx=arr(12, np.int16),
            labels=list(columns[13]) if rows else [],
            by_lat=by_lat, lat_sorted=lat[by_lat],
        )

    # Narrowing

    def band(self, south: float, north: float) -> np.ndarray:
        """Row indices whose latitude is between south and north. This is the bounding-box prefilter."""
        low = np.searchsorted(self.lat_sorted, south, side="left")
        high = np.searchsorted(self.lat_sorted, north, side="right")
        return self.by_lat[low:high]

    def all_rows(self) -> np.ndarray:
        return np.arange(self.count)

    def select(
        self,
        rows: np.ndarray,
        *,
        subset: str,
        slice_name: str,
        month: int | None,
        persistence_label: str | None,
        min_collisions: int,
        bbox: tuple[float, float, float, float] | None = None,
        contains: str = "any",
    ) -> np.ndarray:
        """Applies the filters to candidate rows. A month view never mixes with the All times view."""
        keep = (self.subset_idx[rows] == self.subsets.index(subset)) & (
            self.slice_idx[rows] == self.slices.index(slice_name)
        )
        keep &= self.month[rows] == (month or 0)
        keep &= self.collisions[rows] >= min_collisions
        if contains == "fatal":
            keep &= self.fatal[rows] > 0
        elif contains == "severe":
            keep &= (self.fatal[rows] + self.serious[rows]) > 0
        if persistence_label is not None:
            keep &= self.persistence_idx[rows] == (self.persistence_labels or []).index(persistence_label)
        if bbox is not None:
            west, south, east, north = bbox
            lons = self.lon[rows]
            keep &= (lons >= west) & (lons <= east)
        return rows[keep]

    def sorted_rows(self, rows: np.ndarray, sort: str) -> np.ndarray:
        """Most first. Ties go to more collisions, then the lower id."""
        collisions = self.collisions[rows]
        if sort == "fatal":
            primary = self.fatal[rows].astype(np.float64)
        elif sort == "severe":
            primary = (self.fatal[rows] + self.serious[rows]).astype(np.float64)
        elif sort == "share":
            primary = (self.fatal[rows] + self.serious[rows]) / np.maximum(collisions, 1)
        else:
            primary = collisions.astype(np.float64)
        order = np.lexsort((self.ids[rows], -collisions, -primary))
        return rows[order]

    def nearby(
        self,
        latitude: float,
        longitude: float,
        radius_m: float,
        *,
        subset: str,
        slice_name: str,
        month: int | None,
        min_collisions: int,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Hotspots whose CENTRE is within radius_m of the point, nearest first. Returns the rows and their distances."""
        margin = radius_m / METRES_PER_DEGREE_LAT
        candidates = self.band(latitude - margin, latitude + margin)
        candidates = self.select(
            candidates, subset=subset, slice_name=slice_name, month=month, persistence_label=None,
            min_collisions=min_collisions,
        )
        distances = haversine_m(latitude, longitude, self.lat[candidates], self.lon[candidates])
        inside = distances <= radius_m
        candidates, distances = candidates[inside], distances[inside]
        order = np.lexsort((self.ids[candidates], -self.collisions[candidates], distances))
        return candidates[order], distances[order]

    def along_route(
        self,
        path: list[tuple[float, float]],
        buffer_m: float,
        *,
        subset: str,
        slice_name: str,
        month: int | None,
        min_collisions: int,
        persistence_label: str | None,
        contains: str = "any",
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
        """Hotspots whose centre is within buffer_m of the path. Returns rows, distance from the route, km from the start, and the route length in km.

        Each segment is measured in a local flat frame in metres, with the origin at the segment's start.
        """
        points = np.asarray(path, dtype=np.float64)
        lat_min, lat_max = points[:, 0].min(), points[:, 0].max()
        lon_min, lon_max = points[:, 1].min(), points[:, 1].max()
        lat_margin = buffer_m / METRES_PER_DEGREE_LAT
        lon_margin = buffer_m / (METRES_PER_DEGREE_LAT * max(math.cos(math.radians(max(abs(lat_min), abs(lat_max)))), 1e-6))
        candidates = self.band(lat_min - lat_margin, lat_max + lat_margin)
        candidates = self.select(
            candidates, subset=subset, slice_name=slice_name, month=month, persistence_label=persistence_label,
            min_collisions=min_collisions, contains=contains, bbox=(lon_min - lon_margin, lat_min - lat_margin, lon_max + lon_margin, lat_max + lat_margin),
        )
        clat, clon = self.lat[candidates], self.lon[candidates]
        best = np.full(candidates.shape, np.inf)
        best_km = np.zeros(candidates.shape)
        seg_lengths = haversine_m(points[:-1, 0], points[:-1, 1], points[1:, 0], points[1:, 1])
        cumulative = np.concatenate([[0.0], np.cumsum(seg_lengths)])
        for k in range(len(points) - 1):
            a_lat, a_lon = points[k]
            k_lon = METRES_PER_DEGREE_LAT * math.cos(math.radians(a_lat))
            bx, by = (points[k + 1, 1] - a_lon) * k_lon, (points[k + 1, 0] - a_lat) * METRES_PER_DEGREE_LAT
            px, py = (clon - a_lon) * k_lon, (clat - a_lat) * METRES_PER_DEGREE_LAT
            length_sq = bx * bx + by * by
            t = np.zeros_like(px) if length_sq == 0 else np.clip((px * bx + py * by) / length_sq, 0.0, 1.0)
            distance = np.hypot(px - t * bx, py - t * by)
            better = distance < best
            best = np.where(better, distance, best)
            best_km = np.where(better, cumulative[k] + t * seg_lengths[k], best_km)
        inside = best <= buffer_m
        rows = candidates[inside]
        order = np.lexsort((self.ids[rows], best_km[inside]))
        return rows[order], best[inside][order], best_km[inside][order] / 1000.0, float(cumulative[-1] / 1000.0)

    def row(self, i: int) -> dict[str, Any]:
        persistence = self.persistence_labels[int(self.persistence_idx[i])] if self.persistence_idx[i] >= 0 else None
        years = int(self.years_present[i])
        month = int(self.month[i])
        return {
            "id": int(self.ids[i]),
            "subset": self.subsets[int(self.subset_idx[i])],
            "slice": self.slices[int(self.slice_idx[i])],
            "month": month or None,
            "latitude": float(self.lat[i]),
            "longitude": float(self.lon[i]),
            "radius_m": float(self.radius[i]),
            "collisions": int(self.collisions[i]),
            "fatal": int(self.fatal[i]),
            "serious": int(self.serious[i]),
            "slight": int(self.slight[i]),
            "label": self.labels[i],
            "years_present": years if years >= 0 else None,
            "persistence": persistence,
        }

    def counts_by_subset(self) -> dict[str, int]:
        return {subset: int(np.sum(self.subset_idx == index)) for index, subset in enumerate(self.subsets)}


@dataclass
class ProfileStore:
    years: list[int]
    months: list[int]
    time_slices: list[str]
    share_keys: list[str]
    share_labels: list[str]
    baseline_pct: dict[str, dict[str, float]]
    y: np.ndarray  # shape (N, 5)
    m: np.ndarray  # shape (N, 12)
    t: np.ndarray  # shape (N, 5)
    s: np.ndarray  # shape (N, 8)

    @classmethod
    def from_raw(cls, raw: dict[str, Any], store: HotspotStore) -> ProfileStore:
        """Checks the file against the hotspot rows, then builds the arrays. Row i of the arrays is hotspot id i + 1."""
        rows = [store.row(i) for i in range(store.count)]
        problems = validate_profiles(raw, rows)
        if problems:
            raise ValueError("; ".join(problems[:20]) + (f" (and {len(problems) - 20} more)" if len(problems) > 20 else ""))
        entries = raw["profiles"]
        n = store.count
        y = np.zeros((n, 5), dtype=np.int64)
        m = np.zeros((n, 12), dtype=np.int64)
        t = np.zeros((n, 5), dtype=np.int64)
        s = np.zeros((n, 8), dtype=np.int64)
        for key, profile in entries.items():
            i = int(key) - 1
            y[i], m[i], t[i], s[i] = profile["y"], profile["m"], profile["t"], profile["s"]
        return cls(
            years=list(raw["years"]), months=list(raw["months"]), time_slices=list(raw["time_slices"]),
            share_keys=list(raw["share_keys"]), share_labels=list(raw["share_labels"]),
            baseline_pct=raw["baseline_pct"], y=y, m=m, t=t, s=s,
        )

    def busiest_time(self, i: int) -> str:
        """The time of day with the most collisions. The first one wins a tie."""
        return self.time_slices[int(np.argmax(self.t[i]))]

    def shares(self, i: int, collisions: int, subset: str) -> list[dict[str, Any]]:
        baseline = self.baseline_pct[subset]
        result = []
        for index, key in enumerate(self.share_keys):
            count = int(self.s[i, index])
            here = round(count / collisions * 100, 1) if collisions else 0.0
            result.append({
                "key": key,
                "label": self.share_labels[index],
                "count": count,
                "here_pct": here,
                "gb_pct": float(baseline[key]),
            })
        return result

