from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(tags=["parse"])


class ParseRequest(BaseModel):
    text: str = Field(..., description="Raw command text, must start with '/'")


class ParseResponse(BaseModel):
    ok: bool
    milestone: str
    message: str
    see: str


@router.post("/parse", response_model=ParseResponse)
def parse_stub(_: ParseRequest) -> ParseResponse:
    # M0 stub. Real implementation lands in M1; see docs/02-command-reference.md §5.1.
    return ParseResponse(
        ok=False,
        milestone="M0",
        message="Parser not implemented yet. Landing in M1.",
        see="docs/02-command-reference.md",
    )
