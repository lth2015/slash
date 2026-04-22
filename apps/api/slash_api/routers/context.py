"""GET/POST /context — profile inventory + selection + LLM toggle."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from slash_api.llm import is_enabled as llm_configured
from slash_api.runtime import read_profiles
from slash_api.state import selected, set_selected

router = APIRouter(tags=["context"])


class ContextResponse(BaseModel):
    aws_profiles: list[str]
    gcp_configurations: list[str]
    k8s_contexts: list[str]
    selected_aws: str | None
    selected_gcp: str | None
    selected_k8s: str | None
    llm_enabled: bool
    llm_configured: bool
    errors: list[str]


class SetContextRequest(BaseModel):
    aws: str | None = None
    gcp: str | None = None
    k8s: str | None = None
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
        selected_gcp=sel.gcp,
        selected_k8s=sel.k8s,
        llm_enabled=sel.llm_enabled,
        llm_configured=llm_configured(),
        errors=inv.errors,
    )


@router.post("/context", response_model=ContextResponse)
def post_context(req: SetContextRequest) -> ContextResponse:
    set_selected(aws=req.aws, gcp=req.gcp, k8s=req.k8s, llm_enabled=req.llm_enabled)
    return get_context()
