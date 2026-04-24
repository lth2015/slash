"""POST /help — natural-language help assistant over the skill catalog.

Read-only LLM surface: answers "what can this cockpit do" questions by
citing skills from the loaded registry. No command executes here; the UI
renders the suggested_commands as copy-to-bar chips.

Fallback: when the LLM is disabled (GEMINI_API_KEY missing, or the
Context Bar toggle is off), we return a deterministic static catalog so
`/help` still works — just without a natural-language answer.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from slash_api import audit
from slash_api.llm import help_answer, is_enabled
from slash_api.parser.parser import SkillSpec
from slash_api.state import registry, selected, user

router = APIRouter(tags=["help"])


class HelpRequest(BaseModel):
    question: str = ""


class HelpResponseModel(BaseModel):
    available: bool
    llm_used: bool = False
    model: str | None = None
    summary: str
    highlights: list[str] = []
    findings: list[dict] = []
    suggested_commands: list[str] = []
    reason_unavailable: str | None = None


@router.post("/help", response_model=HelpResponseModel)
def help_endpoint(req: HelpRequest) -> HelpResponseModel:
    reg = registry()
    catalog = _build_catalog(reg.all_skills())
    question = (req.question or "").strip()

    # Is LLM usable for this call? Both the system key and the session toggle
    # must say yes, matching /explain semantics.
    llm_ok = is_enabled() and selected().llm_enabled
    llm_resp = None
    reason_unavailable: str | None = None

    if llm_ok:
        llm_resp = help_answer(
            question=question,
            catalog_json=json.dumps(catalog, ensure_ascii=False),
        )
        if llm_resp is None:
            reason_unavailable = "llm call returned no valid response"
    else:
        reason_unavailable = (
            "GEMINI_API_KEY not set"
            if not is_enabled()
            else "llm toggle is off"
        )

    if llm_resp is not None:
        body = HelpResponseModel(
            available=True,
            llm_used=True,
            model=llm_resp.model,
            summary=llm_resp.summary,
            highlights=list(llm_resp.highlights),
            findings=list(llm_resp.findings),
            # Filter out any command whose stem isn't in the real catalog —
            # belt-and-braces against LLM hallucinating a namespace/verb.
            suggested_commands=_filter_suggestions(
                llm_resp.suggested_commands, catalog
            ),
        )
    else:
        body = _static_help(catalog, question, reason_unavailable)

    # Audit: /help is a read that touches the catalog + optionally LLM. We
    # record the question and whether LLM was consulted so "who asked what"
    # is answerable from audit.jsonl long after the Turn is gone.
    audit.append({
        "user": user(),
        "command": f"/help {question}".strip(),
        "skill_id": "meta.help",
        "mode": "read",
        "risk": "low",
        "state": "ok",
        "summary": body.summary[:400],
        "llm_used": body.llm_used,
    })
    return body


def _build_catalog(skills: list[SkillSpec]) -> list[dict]:
    """Compact projection of every registered skill for the LLM prompt:
    id, description (if any), namespace, verb, mode, danger, and a short
    invocation template assembled from the skill's args."""
    catalog: list[dict] = []
    for s in skills:
        argv_hint: list[str] = []
        for a in s.args:
            if a.positional:
                argv_hint.append(f"<{a.name}>")
            elif a.flag:
                if a.type == "bool":
                    argv_hint.append(f"[{a.flag}]")
                else:
                    argv_hint.append(f"[{a.flag} <{a.name}>]")
        catalog.append({
            "id": s.id,
            "namespace": s.namespace,
            "target": s.target,
            "noun": list(s.noun),
            "verb": s.verb,
            "mode": s.mode,
            "danger": s.danger,
            "description": (s.description or "")[:200],
            "invocation": _render_invocation(s, argv_hint),
        })
    return catalog


def _render_invocation(s: SkillSpec, argv_hint: list[str]) -> str:
    parts: list[str] = ["/" + s.namespace]
    if s.target and s.target not in ("_any",):
        parts.append(s.target)
    parts.extend(list(s.noun))
    parts.append(s.verb)
    parts.extend(argv_hint)
    return " ".join(parts)


def _filter_suggestions(cmds: list[str], catalog: list[dict]) -> list[str]:
    """Drop any suggestion whose `/namespace verb` prefix doesn't appear in
    the catalog. Prevents the LLM from quietly inventing skills."""
    allowed_heads: set[str] = set()
    for entry in catalog:
        inv = entry.get("invocation", "")
        # Head is the token-prefix up through the verb (no flags / positional
        # placeholders). E.g. `/cluster scale` or `/infra aws vm list`.
        tokens = inv.split(" ")
        head: list[str] = []
        for t in tokens:
            if t.startswith("[") or t.startswith("<"):
                break
            head.append(t)
        allowed_heads.add(" ".join(head))
    out: list[str] = []
    for raw in cmds or []:
        s = str(raw).strip()
        if not s.startswith("/"):
            continue
        # Accept if any allowed head is a prefix.
        if any(s == h or s.startswith(h + " ") for h in allowed_heads):
            out.append(s)
    return out[:6]


def _static_help(
    catalog: list[dict], question: str, reason: str | None,
) -> HelpResponseModel:
    """Deterministic fallback when LLM can't answer. We group skills by
    namespace and return the top handful with descriptions so the user
    still gets a tour."""
    by_ns: dict[str, list[dict]] = {}
    for entry in catalog:
        by_ns.setdefault(entry["namespace"], []).append(entry)

    highlights: list[str] = []
    suggested: list[str] = []
    for ns in ("ctx", "cluster", "infra", "app", "ops"):
        items = by_ns.get(ns) or []
        if not items:
            continue
        highlights.append(f"/{ns} — {len(items)} skill(s)")
        # Pick up to 2 read examples per namespace so the chips cover a lot
        # of ground without flooding the card.
        for s in items:
            if len(suggested) >= 6:
                break
            if s["mode"] == "read":
                suggested.append(s["invocation"])

    q = question.strip()
    summary = (
        f"Slash has {len(catalog)} skills across {len(by_ns)} namespaces. "
        "LLM is off, so here's a deterministic tour — turn on the LLM toggle for a "
        "natural-language answer."
    )
    if q:
        summary = f'Question: "{q[:120]}". ' + summary
    return HelpResponseModel(
        available=True,
        llm_used=False,
        model=None,
        summary=summary,
        highlights=highlights,
        suggested_commands=suggested,
        reason_unavailable=reason,
    )
