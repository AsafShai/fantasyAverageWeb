from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class SortOrder(str, Enum):
    ASC = "asc"
    DESC = "desc"


class RankingsRequest(BaseModel):
    sort_by: Optional[str] = Field(None, description="Category to sort by")
    order: SortOrder = Field(SortOrder.DESC, description="Sort order: asc or desc")


class TeamNameRequest(BaseModel):
    team_name: str = Field(..., min_length=1, max_length=100, description="Team name")


class CategoryRequest(BaseModel):
    category: str = Field(..., min_length=1, max_length=50, description="Statistical category")