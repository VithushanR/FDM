from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..schemas.common import ApiValidationError
from ..services.hotspot_service import HotspotService, HotspotUnavailable, get_hotspot_service

router = APIRouter(prefix="/api/hotspots", tags=["hotspots"])
BAD_OPTION = "Choose one of the listed options."


def _unavailable(exc: HotspotUnavailable) -> JSONResponse:
    return JSONResponse(status_code=503, content={"available": False, "message": exc.message})


@router.get("")
def list_hotspots(
    service: HotspotService = Depends(get_hotspot_service),
    subset: str = "all",
    slice_: str = Query("All times", alias="slice"),
    min_collisions: int = Query(1, ge=1),
    limit: int = Query(200, ge=1, le=1000),
):
    try:
        data = service.load()
    except HotspotUnavailable as exc:
        return _unavailable(exc)
    errors = {}
    if subset not in data.subsets:
        errors["subset"] = BAD_OPTION
    if slice_ not in data.slices:
        errors["slice"] = BAD_OPTION
    if errors:
        raise ApiValidationError(errors)
    matches = [
        hotspot for hotspot in data.hotspots
        if hotspot.subset == subset and hotspot.slice == slice_ and hotspot.collisions >= min_collisions
    ]
    matches.sort(key=lambda hotspot: (-hotspot.collisions, hotspot.id))
    chosen = matches[:limit]
    return {
        "count": len(chosen),
        "subset": subset,
        "slice": slice_,
        "hotspots": [hotspot.model_dump() for hotspot in chosen],
    }


@router.get("/meta")
def hotspot_meta(service: HotspotService = Depends(get_hotspot_service)):
    try:
        data = service.load()
    except HotspotUnavailable as exc:
        return _unavailable(exc)
    return {
        "generated_at": data.generated_at.isoformat(),
        "method": data.method,
        "parameters": data.parameters,
        "subsets": data.subsets,
        "slices": data.slices,
        "total_hotspots": len(data.hotspots),
    }
