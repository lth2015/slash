from pathlib import Path

import yaml
from fastapi import APIRouter

router = APIRouter(tags=["skills"])

# repo_root / skills is the canonical location; see docs/04-skills-system.md §1
# parents[0..4] = routers, slash_api, apps/api, apps, repo
REPO_ROOT = Path(__file__).resolve().parents[4]
SKILLS_DIR = REPO_ROOT / "skills"


@router.get("/skills")
def list_skills() -> dict:
    # M0: naive directory walk to prove the mount works. Real registry lands in M1.
    items: list[dict] = []
    if SKILLS_DIR.exists():
        for manifest_path in SKILLS_DIR.rglob("skill.yaml"):
            try:
                with manifest_path.open("r", encoding="utf-8") as fh:
                    manifest = yaml.safe_load(fh) or {}
                meta = manifest.get("metadata", {}) or {}
                spec = manifest.get("spec", {}) or {}
                items.append(
                    {
                        "id": meta.get("id"),
                        "name": meta.get("name"),
                        "version": meta.get("version"),
                        "mode": spec.get("mode"),
                        "path": str(manifest_path.relative_to(REPO_ROOT)),
                    }
                )
            except yaml.YAMLError as exc:
                items.append({"path": str(manifest_path), "error": str(exc)})
    return {
        "milestone": "M0",
        "count": len(items),
        "items": items,
        "see": "docs/04-skills-system.md",
    }
