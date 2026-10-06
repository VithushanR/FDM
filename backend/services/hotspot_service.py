"""Loads the hotspot file. Re-reads it when the file changes, so a new run appears without a restart."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import Request

from ..schemas.hotspots import HotspotFile, HotspotFileError, parse_hotspot_data

NOT_GENERATED = "Hotspot analysis has not been generated yet."


class HotspotUnavailable(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class HotspotService:
    def __init__(self, path: Path):
        self.path = path
        self._stamp: tuple[int, int] | None = None
        self._data: HotspotFile | None = None
        self._problem: str | None = None

    def load(self) -> HotspotFile:
        try:
            stat = self.path.stat()
        except FileNotFoundError:
            raise HotspotUnavailable(NOT_GENERATED) from None
        stamp = (stat.st_mtime_ns, stat.st_size)
        if stamp != self._stamp:
            self._stamp = stamp
            self._data, self._problem = None, None
            try:
                self._data = self._read()
            except HotspotFileError as exc:
                self._problem = str(exc)
        if self._problem is not None:
            raise HotspotUnavailable(self._problem)
        return self._data

    def _read(self) -> HotspotFile:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as exc:
            raise HotspotFileError([f"could not read the file ({exc})"]) from exc
        except json.JSONDecodeError as exc:
            raise HotspotFileError([f"not valid JSON ({exc})"]) from exc
        return parse_hotspot_data(raw)


def get_hotspot_service(request: Request) -> HotspotService:
    return request.app.state.hotspots
