"""Loads the hotspot file and its profiles. Re-reads a file when it changes, so a new run appears without a restart.

The hotspot file is loaded at startup. The profiles file is loaded the first time something needs it, then cached.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

from fastapi import Request

from ..schemas.hotspots import HotspotFileError, load_hotspot_raw, parse_hotspot_data, parse_hotspot_v2
from .hotspot_store import HotspotStore, ProfileStore

NOT_GENERATED = "Hotspot analysis has not been generated yet."
PROFILES_MISSING = "Hotspot profiles have not been generated yet."
PROFILES_NAME = "hotspot_profiles.json.gz"
MAX_PROBLEMS_SHOWN = 20


class HotspotUnavailable(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _shown(problems: list[str]) -> list[str]:
    if len(problems) <= MAX_PROBLEMS_SHOWN:
        return problems
    return problems[:MAX_PROBLEMS_SHOWN] + [f"and {len(problems) - MAX_PROBLEMS_SHOWN} more problems"]


class HotspotService:
    def __init__(self, path: Path):
        self.path = path
        self.profiles_path = path.with_name(PROFILES_NAME)
        self._stamp: tuple[int, int] | None = None
        self._store: HotspotStore | None = None
        self._problem: str | None = None
        self._profile_stamp: tuple[int, int] | None = None
        self._profiles: ProfileStore | None = None
        self._profile_for: HotspotStore | None = None
        self._profile_problem: str | None = None

    # Hotspot file

    def load(self) -> HotspotStore:
        try:
            stat = self.path.stat()
        except FileNotFoundError:
            raise HotspotUnavailable(NOT_GENERATED) from None
        stamp = (stat.st_mtime_ns, stat.st_size)
        if stamp != self._stamp:
            self._stamp = stamp
            self._store, self._problem = None, None
            try:
                self._store = self._read()
            except HotspotFileError as exc:
                self._problem = str(HotspotFileError(_shown(exc.problems)))
        if self._problem is not None:
            raise HotspotUnavailable(self._problem)
        assert self._store is not None
        return self._store

    def _read(self) -> HotspotStore:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as exc:
            raise HotspotFileError([f"could not read the file ({exc})"]) from exc
        except json.JSONDecodeError as exc:
            raise HotspotFileError([f"not valid JSON ({exc})"]) from exc
        if load_hotspot_raw(raw) == 1:
            return HotspotStore.from_v1(parse_hotspot_data(raw))
        return HotspotStore.from_v2(parse_hotspot_v2(raw))

    # Profiles

    def profiles(self) -> ProfileStore:
        """The profiles, loaded on first use and cached for the current hotspot file. Raises HotspotUnavailable."""
        store = self.load()
        try:
            stat = self.profiles_path.stat()
        except FileNotFoundError:
            raise HotspotUnavailable(PROFILES_MISSING) from None
        stamp = (stat.st_mtime_ns, stat.st_size)
        if stamp != self._profile_stamp or store is not self._profile_for:
            self._profile_stamp, self._profile_for = stamp, store
            self._profiles, self._profile_problem = None, None
            try:
                self._profiles = self._read_profiles(store)
            except (OSError, ValueError, UnicodeDecodeError, EOFError) as exc:
                self._profile_problem = f"{self.profiles_path.name} could not be read ({exc})"
        if self._profile_problem is not None:
            raise HotspotUnavailable(self._profile_problem)
        assert self._profiles is not None
        return self._profiles

    def _read_profiles(self, store: HotspotStore) -> ProfileStore:
        with gzip.open(self.profiles_path, "rt", encoding="utf-8") as handle:
            try:
                raw = json.load(handle)
            except json.JSONDecodeError as exc:
                raise ValueError(f"not valid JSON ({exc})") from exc
        if not store.is_v2:
            raise ValueError("profiles need a version 2 hotspot file")
        return ProfileStore.from_raw(raw, store)

    def profiles_available(self) -> bool:
        try:
            self.profiles()
        except HotspotUnavailable:
            return False
        return True


def get_hotspot_service(request: Request) -> HotspotService:
    return request.app.state.hotspots

