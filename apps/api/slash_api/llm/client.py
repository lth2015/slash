"""Gemini 2.5 Flash client — uses the stable `google-generativeai` SDK.

Produces a strictly-shaped ExplainResponse. On any error returns None; the
router falls back to "[LLM unavailable, raw result above]".
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

from slash_api.llm.prompts import (
    HELP_SYSTEM_PROMPT,
    MODEL_ID,
    RESPONSE_SCHEMA,
    SYSTEM_PROMPT,
    build_help_user_prompt,
    build_user_prompt,
)

log = logging.getLogger("slash.llm")


def is_enabled() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


@dataclass
class ExplainResponse:
    summary: str
    highlights: list[str] = field(default_factory=list)
    findings: list[dict] = field(default_factory=list)
    suggested_commands: list[str] = field(default_factory=list)
    model: str = MODEL_ID

    def to_dict(self) -> dict:
        return {
            "summary": self.summary,
            "highlights": self.highlights,
            "findings": self.findings,
            "suggested_commands": self.suggested_commands,
            "model": self.model,
        }


def explain(
    *,
    command: str,
    skill_id: str,
    skill_mode: str,
    skill_danger: bool,
    result_state: str,
    result_outputs: Any,
    stdout_excerpt: str,
) -> ExplainResponse | None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        import google.generativeai as genai  # type: ignore
    except ImportError:
        log.warning("google-generativeai not installed — LLM disabled")
        return None

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name=MODEL_ID,
            system_instruction=SYSTEM_PROMPT,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": RESPONSE_SCHEMA,
                "temperature": 0.2,
                "max_output_tokens": 1024,
            },
        )
        user_prompt = build_user_prompt(
            command=command,
            skill_id=skill_id,
            skill_mode=skill_mode,
            skill_danger=skill_danger,
            result_state=result_state,
            result_outputs_json=json.dumps(result_outputs, default=str),
            stdout_excerpt=stdout_excerpt,
        )
        resp = model.generate_content(user_prompt)
        raw = resp.text or ""
    except Exception as exc:  # noqa: BLE001
        log.warning("gemini call failed: %s", exc)
        return None

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        log.warning("gemini returned non-JSON: %s", exc)
        return None

    if not isinstance(payload, dict) or "summary" not in payload:
        return None

    try:
        return ExplainResponse(
            summary=str(payload.get("summary", "")).strip(),
            highlights=[str(x) for x in payload.get("highlights", [])][:5],
            findings=[
                {"level": str(f.get("level", "info")), "detail": str(f.get("detail", ""))}
                for f in payload.get("findings", [])
                if isinstance(f, dict)
            ][:10],
            suggested_commands=[str(x) for x in payload.get("suggested_commands", [])][:5],
        )
    except Exception:  # noqa: BLE001
        return None


def help_answer(*, question: str, catalog_json: str) -> ExplainResponse | None:
    """Answer a natural-language question about Slash's skill catalog.

    Uses the same structured-JSON shape as `/explain` so the UI can reuse
    LlmSummaryCard. The system prompt narrows the contract: only commands
    from the provided catalog may appear in suggested_commands, nothing
    gets "executed", no past-tense claims about system state.

    Returns None when the Gemini SDK isn't installed, the API key is
    missing, or the response fails schema validation. Routers should
    fall back to a static catalog listing in those cases.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        import google.generativeai as genai  # type: ignore
    except ImportError:
        log.warning("google-generativeai not installed — LLM disabled")
        return None

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name=MODEL_ID,
            system_instruction=HELP_SYSTEM_PROMPT,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": RESPONSE_SCHEMA,
                "temperature": 0.2,
                "max_output_tokens": 1024,
            },
        )
        user_prompt = build_help_user_prompt(question=question, catalog_json=catalog_json)
        resp = model.generate_content(user_prompt)
        raw = resp.text or ""
    except Exception as exc:  # noqa: BLE001
        log.warning("gemini help call failed: %s", exc)
        return None

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        log.warning("gemini help returned non-JSON: %s", exc)
        return None

    if not isinstance(payload, dict) or "summary" not in payload:
        return None

    try:
        return ExplainResponse(
            summary=str(payload.get("summary", "")).strip(),
            highlights=[str(x) for x in payload.get("highlights", [])][:8],
            findings=[
                {"level": str(f.get("level", "info")), "detail": str(f.get("detail", ""))}
                for f in payload.get("findings", [])
                if isinstance(f, dict)
            ][:10],
            suggested_commands=[str(x) for x in payload.get("suggested_commands", [])][:6],
        )
    except Exception:  # noqa: BLE001
        return None
