"""GET /skills — list loaded skills (with arg specs for UI autocomplete)."""

from fastapi import APIRouter

from slash_api.state import registry

router = APIRouter(tags=["skills"])


@router.get("/skills")
def list_skills() -> dict:
    reg = registry()
    items = [
        {
            "id": s.id,
            "namespace": s.namespace,
            "target": s.target,
            "noun": list(s.noun),
            "verb": s.verb,
            "mode": s.mode,
            "danger": s.danger,
            "args": [
                {
                    "name": a.name,
                    "flag": a.flag,
                    "type": a.type,
                    "required": a.required,
                    "default": a.default,
                    "positional": a.positional,
                    "repeatable": a.repeatable,
                    "enum": list(a.enum) if a.enum else None,
                }
                for a in s.args
            ],
        }
        for s in reg.all_skills()
    ]
    return {"count": len(items), "items": items}
