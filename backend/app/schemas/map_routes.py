from typing import Literal
from pydantic import BaseModel, field_validator


class SpecialRouteRequest(BaseModel):
    mode: Literal['motorcycle','electric']
    origin: tuple[float,float]
    destination: tuple[float,float]

    @field_validator('origin','destination')
    @classmethod
    def valid_coordinate(cls,value):
        if not (-180 <= value[0] <= 180 and -85 <= value[1] <= 85):
            raise ValueError('Invalid coordinates')
        return value
