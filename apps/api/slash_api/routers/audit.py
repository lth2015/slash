"""GET /audit — query the JSONL audit log."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from slash_api.audit import query

router = APIRouter(tags=["audit"])


class AuditResponse(BaseModel):
    items: list[dict]
    count: int


@router.get("/audit", response_model=AuditResponse)
def get_audit(
    since_seconds: int | None = None,
    user: str | None = None,
    command_prefix: str | None = None,
    limit: int = 200,
) -> AuditResponse:
    items = query(
        since_seconds=since_seconds,
        user=user,
        command_prefix=command_prefix,
        limit=limit,
    )
    return AuditResponse(items=items, count=len(items))
