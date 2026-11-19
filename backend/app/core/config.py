from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT / ".env", ROOT / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    database_url: str = "sqlite+aiosqlite:///./jarvis_tg.db"
    frontend_origin: str = "http://localhost:5173"

    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = ""
    deepseek_fast_model: str = "deepseek-flash"
    model_timeout_seconds: float = 30
    model_max_retries: int = 2
    model_max_concurrency: int = 3

    open_meteo_enabled: bool = True
    amap_api_key: str = ""
    amap_base_url: str = "https://restapi.amap.com"
    amap_js_api_key: str = ""
    amap_js_security_code: str = ""
    qweather_api_key: str = ""
    qweather_api_host: str = ""
    tavily_api_key: str = ""
    tavily_base_url: str = "https://api.tavily.com"
    brave_search_api_key: str = ""
    exa_api_key: str = ""
    variflight_mcp_key: str = ""
    didi_mcp_key: str = ""
    fliggy_api_key: str = ""
    meituan_ht_token: str = ""
    variflight_mcp_url: str = "https://c-gw.variflight.com/chat_message/mcp/api"
    tool_timeout_seconds: float = 15


@lru_cache
def get_settings() -> Settings:
    from app.core.service_settings import read_overrides
    return Settings(**read_overrides())

