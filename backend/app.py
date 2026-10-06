"""FastAPI app. Run from the repo root with: uvicorn backend.app:app --reload"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import (
    ABOUT_PATH, CODE_LABELS_PATH, COVERAGE_GRID_PATH, FRONTEND_DIR, cors_origins, load_model_config,
    resolve_hotspot_path, resolve_model_path,
)
from .routers import about, classification, hotspots
from .schemas.about import AboutFileError, load_about
from .schemas.common import ApiValidationError
from .services.coverage_service import CoverageService
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


def _static_root(frontend_root: Path) -> Path | None:
    """frontend/dist if it has a built index.html, else frontend/ if it has one, else nothing."""
    for candidate in (frontend_root / "dist", frontend_root):
        if (candidate / "index.html").exists():
            return candidate
    return None


def create_app(
    model_path=None,
    hotspot_path=None,
    config_path=None,
    about_path=None,
    coverage_path=None,
    frontend_root=None,
) -> FastAPI:
    """Explicit arguments override environment variables, which override model_config.json."""
    config = load_model_config(Path(config_path) if config_path else None)
    resolved_model = resolve_model_path(config, model_path)
    resolved_hotspots = resolve_hotspot_path(hotspot_path)
    resolved_about = Path(about_path) if about_path else ABOUT_PATH
    resolved_coverage = Path(coverage_path) if coverage_path else COVERAGE_GRID_PATH

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # The services never raise on a bad file. They store the problem and the routers report it.
        app.state.model = ModelService(resolved_model, config, CODE_LABELS_PATH)
        app.state.hotspots = HotspotService(resolved_hotspots)
        app.state.coverage = CoverageService(resolved_coverage, config.get("location", {}))
        try:
            app.state.about = load_about(resolved_about)
            app.state.about_error = None
        except AboutFileError as exc:
            app.state.about = None
            app.state.about_error = str(exc)
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
    app.include_router(about.router)

    # Registered last, so every API route above is matched first.
    static_root = _static_root(Path(frontend_root) if frontend_root else FRONTEND_DIR)
    if static_root is not None:
        root = static_root.resolve()

        @app.get("/{full_path:path}", include_in_schema=False)
        async def frontend(full_path: str):
            if full_path == "api" or full_path.startswith("api/"):
                return JSONResponse(status_code=404, content={"detail": "Not Found"})
            candidate = (root / full_path).resolve()
            if full_path and candidate.is_file() and candidate.is_relative_to(root):
                return FileResponse(candidate)
            # Client-side routes such as /hotspots are answered by the app's own index.html.
            return FileResponse(root / "index.html")

    return app


app = create_app()
