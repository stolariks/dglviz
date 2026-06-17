from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, Literal


class PositionSource(BaseModel):
    key: str = "feat"
    x_col: int = 0
    y_col: int = 1
    z_col: int = 2


class FeatureSelector(BaseModel):
    key: str
    index: Optional[int] = None  # None = scalar, int = column of a vector feature


class SimpleFilter(BaseModel):
    key: str
    index: Optional[int] = None
    op: Literal["<", "<=", ">", ">=", "==", "!="]
    value: float


class FilterConfig(BaseModel):
    enabled: bool = False
    advanced: bool = False
    simple: Optional[SimpleFilter] = None
    expression: Optional[str] = None  # Python expression for advanced mode


class ROIBox(BaseModel):
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    z_min: float
    z_max: float


class ROISphere(BaseModel):
    cx: float
    cy: float
    cz: float
    radius: float


class ROIConfig(BaseModel):
    enabled: bool = False
    type: Literal["box", "sphere"] = "box"
    box: Optional[ROIBox] = None
    sphere: Optional[ROISphere] = None


class QueryRequest(BaseModel):
    position_source: PositionSource = Field(default_factory=PositionSource)
    node_color: Optional[FeatureSelector] = None
    node_filter: FilterConfig = Field(default_factory=FilterConfig)
    node_subsample: int = Field(default=10000, gt=0, le=500000)
    show_edges: bool = False
    edge_color: Optional[FeatureSelector] = None
    edge_filter: FilterConfig = Field(default_factory=FilterConfig)
    edge_subsample: int = Field(default=50000, gt=0, le=500000)
    roi: ROIConfig = Field(default_factory=ROIConfig)
