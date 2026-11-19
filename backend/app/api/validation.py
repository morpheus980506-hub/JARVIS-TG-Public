"""Return validation failures without echoing credentials or non-JSON numeric values."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def install_validation_handler(app: FastAPI):
    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request,error: RequestValidationError):
        return JSONResponse(status_code=422,content={'detail':[
            {key:item[key] for key in ['loc','msg','type'] if key in item}
            for item in error.errors()
        ]})
