"""Skill registry — loads manifests from skills/ and indexes them.

See docs/04-skills-system.md.
"""

from slash_api.registry.loader import SkillRegistry, load_registry

__all__ = ["SkillRegistry", "load_registry"]
