"""Paths and settings. Environment variables override the defaults."""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT / "backend"
RESOURCES_DIR = BACKEND_DIR / "resources"
FRONTEND_DIR = ROOT / "frontend"

MODEL_CONFIG_PATH = RESOURCES_DIR / "model_config.json"
CODE_LABELS_PATH = RESOURCES_DIR / "code_labels.json"
DEFAULT_HOTSPOT_PATH = ROOT / "results" / "spatial_temporal" / "hotspots.json"


def load_model_config(path: Path | None = None) -> dict:
    with open(path or MODEL_CONFIG_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def resolve_model_path(config: dict, override: str | Path | None = None) -> Path:
    """Explicit argument, then MODEL_PATH, then model_config.json. Relative paths are from the repo root."""
    chosen = override or os.environ.get("MODEL_PATH") or config["model_path"]
    path = Path(chosen)
    return path if path.is_absolute() else ROOT / path


def resolve_hotspot_path(override: str | Path | None = None) -> Path:
    chosen = override or os.environ.get("HOTSPOT_PATH")
    if not chosen:
        return DEFAULT_HOTSPOT_PATH
    path = Path(chosen)
    return path if path.is_absolute() else ROOT / path


def cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
