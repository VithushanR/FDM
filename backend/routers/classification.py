from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..schemas.classification import (
    HealthOk, LocationCheckResponse, PredictResponse, SchemaResponse, location_range_errors, parse_form,
    parse_location,
)
from ..schemas.common import ApiValidationError
from ..services.coverage_service import CoverageService, get_coverage_service
from ..services.model_service import FORM_ORDER, ModelService, get_model_service

router = APIRouter(prefix="/api", tags=["classification"])


async def _json_body(request: Request):
    try:
        return await request.json()
    except ValueError:
        return None


@router.get("/health", response_model=HealthOk)
def health(
    service: ModelService = Depends(get_model_service),
    coverage: CoverageService = Depends(get_coverage_service),
):
    if not service.loaded:
        return JSONResponse(status_code=503, content={"status": "error", "error": service.error})
    return {
        "status": "ok",
        "model": service.model_name,
        "demo": service.demo,
        "warnings": service.warnings + coverage.warnings,
        "coverage_grid": coverage.health_text(),
    }


@router.get("/schema", response_model=SchemaResponse)
def form_schema(service: ModelService = Depends(get_model_service)):
    if not service.loaded:
        return JSONResponse(status_code=503, content={"loaded": False, "error": service.error})
    return service.schema()


@router.post("/location/check", response_model=LocationCheckResponse)
async def check_location(request: Request, coverage: CoverageService = Depends(get_coverage_service)):
    latitude, longitude, errors = parse_location(await _json_body(request))
    if errors:
        raise ApiValidationError(errors)
    return coverage.check(latitude, longitude)


@router.post("/predict", response_model=PredictResponse)
async def predict(
    request: Request,
    service: ModelService = Depends(get_model_service),
    coverage: CoverageService = Depends(get_coverage_service),
):
    if not service.loaded:
        return JSONResponse(status_code=503, content={"loaded": False, "error": service.error})
    values, errors = parse_form(await _json_body(request))
    if "body" in errors:
        raise ApiValidationError(errors)
    answers, errors, left_blank = service.check_answers(values, errors)

    warnings: list[str] = []
    location = None
    latitude, longitude = values.get("latitude"), values.get("longitude")
    if latitude is not None and longitude is not None and "latitude" not in errors and "longitude" not in errors:
        # The cheap range check first, so the coverage check only sees points inside the box.
        range_errors = location_range_errors(latitude, longitude)
        if range_errors:
            errors.update(range_errors)
        else:
            check = coverage.check(latitude, longitude)
            location = {"status": check["status"], "nearest_km": check["nearest_km"]}
            if check["status"] == "outside":
                errors["latitude"] = check["message"]
            elif check["status"] == "sparse":
                warnings.append(check["message"])
    if errors:
        raise ApiValidationError(dict(sorted(errors.items(), key=lambda item: FORM_ORDER.get(item[0], len(FORM_ORDER)))))

    result = service.predict(answers, left_blank)
    result["warnings"] = warnings
    result["location"] = location
    return result
