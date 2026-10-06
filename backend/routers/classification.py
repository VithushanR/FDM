from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..schemas.classification import HealthOk, PredictResponse, SchemaResponse, parse_form
from ..schemas.common import ApiValidationError
from ..services.model_service import ModelService, get_model_service

router = APIRouter(prefix="/api", tags=["classification"])


@router.get("/health", response_model=HealthOk)
def health(service: ModelService = Depends(get_model_service)):
    if not service.loaded:
        return JSONResponse(status_code=503, content={"status": "error", "error": service.error})
    return {
        "status": "ok",
        "model": service.model_name,
        "demo": service.demo,
        "warnings": service.warnings,
    }


@router.get("/schema", response_model=SchemaResponse)
def form_schema(service: ModelService = Depends(get_model_service)):
    if not service.loaded:
        return JSONResponse(status_code=503, content={"loaded": False, "error": service.error})
    return service.schema()


@router.post("/predict", response_model=PredictResponse)
async def predict(request: Request, service: ModelService = Depends(get_model_service)):
    if not service.loaded:
        return JSONResponse(status_code=503, content={"loaded": False, "error": service.error})
    try:
        raw = await request.json()
    except ValueError:
        raw = None
    values, errors = parse_form(raw)
    if "body" in errors:
        raise ApiValidationError(errors)
    answers, errors, left_blank = service.check_answers(values, errors)
    if errors:
        raise ApiValidationError(errors)
    return service.predict(answers, left_blank)
