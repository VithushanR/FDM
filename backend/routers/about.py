from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api", tags=["about"])


@router.get("/about")
def about(request: Request):
    # about.json is checked once at startup. A bad file is reported here, not hidden.
    if request.app.state.about_error is not None:
        return JSONResponse(
            status_code=503,
            content={"available": False, "message": request.app.state.about_error},
        )
    return request.app.state.about
