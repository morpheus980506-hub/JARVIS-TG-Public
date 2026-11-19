from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import build_router


def test_map_config_exposes_public_key_but_not_security_code() -> None:
    settings = SimpleNamespace(
        amap_js_api_key="public-js-key",
        amap_js_security_code="server-only-secret",
    )
    app = FastAPI()
    app.include_router(build_router(SimpleNamespace(settings=settings)))

    response = TestClient(app).get("/api/v1/config/map")

    assert response.status_code == 200
    assert response.json() == {
        "enabled": True,
        "key": "public-js-key",
        "version": "2.0",
        "service_host": "/api/v1/_AMapService",
    }
    assert "server-only-secret" not in response.text
