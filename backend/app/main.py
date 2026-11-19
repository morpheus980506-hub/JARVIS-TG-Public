from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import build_router
from app.api.settings_routes import build_settings_router
from app.api.didi_routes import build_didi_router
from app.api.travel_routes import build_travel_router
from app.api.workspace_routes import build_workspace_router
from app.api.validation import install_validation_handler
from app.core.config import get_settings
from app.core.version import VERSION
from app.core.logging import configure_logging
from app.database.db import init_db
from app.orchestrator.engine import Orchestrator


configure_logging()
settings = get_settings()
orchestrator = Orchestrator(settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="JARVIS Travel Guider API",
    description="Multi-agent travel planning and execution platform",
    version=VERSION,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
install_validation_handler(app)
app.include_router(build_router(orchestrator))
app.include_router(build_settings_router(orchestrator))
app.include_router(build_didi_router(orchestrator))
app.include_router(build_travel_router(orchestrator))
app.include_router(build_workspace_router(orchestrator))


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": "JARVIS Travel Guider", "docs": "/docs"}

