"""FastAPI app. Run from the repo root with: uvicorn backend.app:app --reload"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import (
    CODE_LABELS_PATH, FRONTEND_DIR, cors_origins, load_model_config, resolve_hotspot_path, resolve_model_path,
)
from .routers import classification, hotspots
from .schemas.common import ApiValidationError
from .services.hotspot_service import HotspotService
from .services.model_service import ModelService


def _friendly_request_error(error: dict) -> dict:
    parts = [part for part in error["loc"] if part not in ("query", "body", "path")]
    field = str(parts[0]) if parts else "request"
    kind, ctx = error["type"], error.get("ctx", {})
    if kind == "greater_than_equal":
        message = f"Enter a number of at least {ctx['ge']}."
    elif kind == "less_than_equal":
        message = f"Enter a number of at most {ctx['le']}."
    elif kind.startswith("int"):
        message = "Enter a whole number."
    elif kind.startswith("float"):
        message = "Enter a number."
    else:
        message = "Enter a valid value."
    return {"field": field, "message": message}


def create_app(model_path=None, hotspot_path=None, config_path=None) -> FastAPI:
    """Explicit arguments override environment variables, which override model_config.json."""
    config = load_model_config(Path(config_path) if config_path else None)
    resolved_model = resolve_model_path(config, model_path)
    resolved_hotspots = resolve_hotspot_path(hotspot_path)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # The services never raise on a bad file. They store the problem and the routers report it as 503.
        app.state.model = ModelService(resolved_model, config, CODE_LABELS_PATH)
        app.state.hotspots = HotspotService(resolved_hotspots)
        yield

    app = FastAPI(title="FDM collision severity API", lifespan=lifespan)

    @app.exception_handler(ApiValidationError)
    async def api_validation_error(request: Request, exc: ApiValidationError):
        return JSONResponse(status_code=422, content={"errors": exc.errors})

    @app.exception_handler(RequestValidationError)
    async def request_validation_error(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={"errors": [_friendly_request_error(error) for error in exc.errors()]},
        )

    origins = cors_origins()
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

    app.include_router(classification.router)
    app.include_router(hotspots.router)

    # Mounted last so the API routes above take priority over the static files.
    if (FRONTEND_DIR / "index.html").exists():
        app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

    return app


app = create_app()
