"""FastAPI application factory (slice ①)."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from polyopus import __version__
from polyopus.api.routers import attentions, auth, threads
from polyopus.config import Settings, load_settings
from polyopus.platform.errors import AppError
from polyopus.platform.telemetry import log as tlog

logger = tlog.get_logger("polyopus.api")

HTTP_CODE_MAP = {
    400: "VALIDATION_FAILED",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "VALIDATION_FAILED",
    429: "RATE_LIMITED",
}


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="PolyOpus", version=__version__)
    app.state.settings = settings or load_settings()

    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(threads.router, prefix="/api/v1")
    app.include_router(attentions.router, prefix="/api/v1")

    @app.middleware("http")
    async def trace_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        trace_id = request.headers.get("X-Trace-Id") or tlog.new_trace_id()
        request.state.trace_id = trace_id
        tlog.set_trace_id(trace_id)
        response = await call_next(request)
        response.headers["X-Trace-Id"] = trace_id
        return response

    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError) -> JSONResponse:
        trace_id = getattr(request.state, "trace_id", None)
        locale = request.headers.get("Accept-Language") or "en"
        return JSONResponse(
            status_code=exc.status(),
            content=exc.to_payload(trace_id=trace_id, locale=locale),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        fields = [
            {"loc": list(err.get("loc", [])), "msg": err.get("msg"), "type": err.get("type")}
            for err in exc.errors()
        ]
        error = AppError(
            "VALIDATION_FAILED", http_status=422, details={"fields": fields}
        )
        trace_id = getattr(request.state, "trace_id", None)
        return JSONResponse(
            status_code=422, content=error.to_payload(trace_id=trace_id)
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = HTTP_CODE_MAP.get(exc.status_code, "INTERNAL_ERROR")
        error = AppError(
            code,
            http_status=exc.status_code,
            details={"path": request.url.path},
        )
        trace_id = getattr(request.state, "trace_id", None)
        return JSONResponse(
            status_code=exc.status_code, content=error.to_payload(trace_id=trace_id)
        )

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        trace_id = getattr(request.state, "trace_id", None)
        tlog.log(logger, 40, "unhandled_error", path=request.url.path, error=str(exc))
        error = AppError("INTERNAL_ERROR")
        return JSONResponse(
            status_code=500, content=error.to_payload(trace_id=trace_id)
        )

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app


app = create_app()
