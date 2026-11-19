import logging
from uuid import uuid4


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # HTTPX includes the complete URL at INFO level. Some providers put API
    # keys in query parameters, so request-line logging must stay disabled.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def new_trace_id() -> str:
    return uuid4().hex

