"""POST /explain — read-only LLM summary + divergence guard."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from slash_api.llm import check_divergence, is_enabled
from slash_api.llm import explain as llm_explain
from slash_api.state import selected

router = APIRouter(tags=["explain"])


class ExplainRequest(BaseModel):
    command: str
    skill_id: str
    skill_mode: str
    skill_danger: bool = False
    result_state: str
    result_outputs: Any = None
    stdout_excerpt: str = ""


class ExplainResponseModel(BaseModel):
    available: bool
    model: str | None = None
    summary: str | None = None
    highlights: list[str] = []
    findings: list[dict] = []
    suggested_commands: list[str] = []
    divergence_warnings: list[str] = []
    reason_unavailable: str | None = None


@router.post("/explain", response_model=ExplainResponseModel)
def explain_endpoint(req: ExplainRequest) -> ExplainResponseModel:
    # Respect the user-facing LLM toggle — if the UI says off, we refuse to call
    # Gemini even if GEMINI_API_KEY is present. This is a safety default.
    if not selected().llm_enabled:
        return ExplainResponseModel(available=False, reason_unavailable="llm toggle is off")
    if not is_enabled():
        return ExplainResponseModel(available=False, reason_unavailable="GEMINI_API_KEY not set")

    resp = llm_explain(
        command=req.command,
        skill_id=req.skill_id,
        skill_mode=req.skill_mode,
        skill_danger=req.skill_danger,
        result_state=req.result_state,
        result_outputs=req.result_outputs,
        stdout_excerpt=req.stdout_excerpt,
    )
    if resp is None:
        raise HTTPException(
            status_code=502,
            detail={"code": "LLMUnavailable", "message": "Gemini did not produce a valid response."},
        )

    warnings = check_divergence(
        summary=resp.summary,
        raw_stdout=req.stdout_excerpt,
        structured_outputs=req.result_outputs,
        result_state=req.result_state,
    )
    return ExplainResponseModel(
        available=True,
        model=resp.model,
        summary=resp.summary,
        highlights=resp.highlights,
        findings=resp.findings,
        suggested_commands=resp.suggested_commands,
        divergence_warnings=warnings,
    )
