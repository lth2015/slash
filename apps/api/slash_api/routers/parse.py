"""POST /parse — strict parse + registry resolution. See docs/02-command-reference.md §5.1."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from slash_api.parser import ParseError, parse
from slash_api.state import registry

router = APIRouter(tags=["parse"])


class ParseRequest(BaseModel):
    text: str = Field(..., description="Raw command text, must start with '/'")


class ParseOk(BaseModel):
    ok: bool = True
    skill_id: str
    namespace: str
    target: str | None
    noun: list[str]
    verb: str
    positional: list[Any]
    flags: dict[str, Any]
    mode: str
    danger: bool


class ParseFail(BaseModel):
    ok: bool = False
    code: str
    message: str
    offset: int
    length: int
    suggestions: list[str]


@router.post("/parse")
def parse_command(req: ParseRequest) -> ParseOk | ParseFail:
    reg = registry()
    try:
        ast = parse(req.text, reg.lookup)
    except ParseError as exc:
        return ParseFail(
            code=exc.code,
            message=exc.message,
            offset=exc.offset,
            length=exc.length,
            suggestions=list(exc.suggestions),
        )
    skill = next((s for s in reg.all_skills() if s.id == ast.skill_id), None)
    return ParseOk(
        skill_id=ast.skill_id,
        namespace=ast.namespace,
        target=ast.target,
        noun=ast.noun,
        verb=ast.verb,
        positional=ast.positional,
        flags=ast.flags,
        mode=skill.mode if skill else "read",
        danger=skill.danger if skill else False,
    )
