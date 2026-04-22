"""GET/POST /context — profile inventory + pin state + tiers + LLM toggle."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from slash_api.llm import is_enabled as llm_configured
from slash_api.runtime import read_profiles
from slash_api.state import drift_seconds, selected, set_selected

router = APIRouter(tags=["context"])

Tier = Literal["critical", "staging", "safe"]


class ContextResponse(BaseModel):
    aws_profiles: list[str]
    gcp_configurations: list[str]
    k8s_contexts: list[str]
    selected_aws: str | None
    selected_aws_tier: Tier
    selected_gcp: str | None
    selected_gcp_tier: Tier
    selected_k8s: str | None
    selected_k8s_tier: Tier
    # Seconds since the most recent pin change per kind. null = never pinned.
    # Consumers (drift guard) compare against a window (60s).
    drift_k8s: float | None
    drift_aws: float | None
    drift_gcp: float | None
    llm_enabled: bool
    llm_configured: bool
    errors: list[str]


class SetContextRequest(BaseModel):
    aws: str | None = None
    aws_tier: Tier | None = None
    gcp: str | None = None
    gcp_tier: Tier | None = None
    k8s: str | None = None
    k8s_tier: Tier | None = None
    llm_enabled: bool | None = None


@router.get("/context", response_model=ContextResponse)
def get_context() -> ContextResponse:
    inv = read_profiles()
    sel = selected()
    return ContextResponse(
        aws_profiles=inv.aws_profiles,
        gcp_configurations=inv.gcp_configurations,
        k8s_contexts=inv.k8s_contexts,
        selected_aws=sel.aws,
        selected_aws_tier=sel.aws_tier,
        selected_gcp=sel.gcp,
        selected_gcp_tier=sel.gcp_tier,
        selected_k8s=sel.k8s,
        selected_k8s_tier=sel.k8s_tier,
        drift_k8s=drift_seconds("k8s"),
        drift_aws=drift_seconds("aws"),
        drift_gcp=drift_seconds("gcp"),
        llm_enabled=sel.llm_enabled,
        llm_configured=llm_configured(),
        errors=inv.errors,
    )


@router.post("/context", response_model=ContextResponse)
def post_context(req: SetContextRequest) -> ContextResponse:
    set_selected(
        aws=req.aws,
        aws_tier=req.aws_tier,
        gcp=req.gcp,
        gcp_tier=req.gcp_tier,
        k8s=req.k8s,
        k8s_tier=req.k8s_tier,
        llm_enabled=req.llm_enabled,
    )
    return get_context()
