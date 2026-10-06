"""Shared fixtures. Stand-in models are built here in temporary folders, never in models/."""

import json
from pathlib import Path

import joblib
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.config import load_model_config
from tools.make_dummy_model import build_pipeline

# The stand-in takes its category codes from code_labels.json when it exists. Tests pass a missing path so the
# codes are always the fallback 1 to 5 that VALID_FORM uses, whatever labels file is on disk.
NO_LABELS = Path("no_code_labels_for_tests.json")

# Codes the stand-in model knows (see tools/make_dummy_model.py FALLBACK_CODES).
VALID_FORM = {
    "date": "2024-03-15",
    "time": "18:30",
    "road_type": 3,
    "speed_limit": "30",
    "urban_or_rural_area": 1,
    "junction_detail": 2,
    "light_conditions": 1,
    "weather_conditions": 1,
    "road_surface_conditions": 1,
    "number_of_vehicles": 2,
    "vehicles": ["car", "pedal_cycle"],
    "driver_ages": "34, 9",
    "latitude": 51.5072,
    "longitude": -0.1276,
}


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in ("MODEL_PATH", "HOTSPOT_PATH", "CORS_ORIGINS"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(scope="session")
def dummy_model_path(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("models") / "dummy_pipeline.joblib"
    joblib.dump(build_pipeline(labels_path=NO_LABELS), path)
    return path


@pytest.fixture(scope="session")
def precollision_model_path(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("models") / "dummy_precollision_pipeline.joblib"
    joblib.dump(build_pipeline(precollision=True, labels_path=NO_LABELS), path)
    return path


@pytest.fixture
def write_config(tmp_path):
    """Writes a model_config.json with the given keys changed and returns its path."""
    def write(**changes) -> Path:
        config = load_model_config()
        config.update(changes)
        path = tmp_path / "model_config.json"
        path.write_text(json.dumps(config), encoding="utf-8")
        return path
    return write


@pytest.fixture
def make_client(tmp_path):
    """Starts the app (which runs the lifespan) and yields a client. Missing hotspot file unless one is given."""
    def start(model_path, config_path=None, hotspot_path=None, coverage_path=None, about_path=None, frontend_root=None):
        # No coverage grid unless one is given, so tests do not depend on a grid built on this machine.
        app = create_app(
            model_path=model_path,
            config_path=config_path,
            hotspot_path=hotspot_path or tmp_path / "no_hotspots_here.json",
            coverage_path=coverage_path or tmp_path / "no_coverage_grid_here.npz",
            about_path=about_path,
            frontend_root=frontend_root or tmp_path / "no_frontend_here",
        )
        return TestClient(app)
    return start


@pytest.fixture
def client(make_client, dummy_model_path):
    with make_client(dummy_model_path) as test_client:
        yield test_client
