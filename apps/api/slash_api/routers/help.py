"""POST /help — natural-language help assistant over the skill catalog.

Read-only LLM surface: answers "what can this cockpit do" questions by
citing skills from the loaded registry. No command executes here; the UI
renders the suggested_commands as copy-to-bar chips.

Fallback: when the LLM is disabled (GEMINI_API_KEY missing, or the
Context Bar toggle is off), we run a deterministic keyword match over
the catalog (bilingual zh/en via a small synonym bridge) and rank skills
by how many tokens in the question their id + description contain. That
way `/help` still *earns its keep* without the LLM — it picks the right
skills, not a generic tour.
"""

from __future__ import annotations

import json
import re
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
    """Deterministic fallback when LLM can't answer.

    Two modes:
      - With a real question → bilingual keyword match. Tokens from the
        question (ASCII words + CJK bigrams) are expanded through a small
        SRE-flavored synonym dict, then each skill's id + description +
        namespace + noun + verb is scored by token hits. Top matches lead.
      - Empty question → namespace tour (old behavior).

    This is *not* as good as the LLM — it can't chain multiple steps or
    reason about workflows — but it reliably surfaces the right skills
    for a focused question like "查看 ec2 状态".
    """
    q = (question or "").strip()
    if not q:
        return _catalog_tour(catalog, q, reason)

    ranked = _rank_by_question(catalog, q)
    # Drop weak matches so a single generic token ("list", "get") can't flood
    # the card with irrelevant chips. Cutoff = max(top_score * 0.5, 1.5).
    if ranked:
        top_score = ranked[0]["score"]
        cutoff = max(top_score * 0.5, 1.5)
        matches = [m for m in ranked if m["score"] >= cutoff]
    else:
        matches = []

    if not matches:
        tour = _catalog_tour(catalog, q, reason)
        tour.summary = (
            f'No keyword in "{_clip(q, 80)}" matched any skill description. '
            "Turn on the LLM toggle for a smarter answer, or browse the tour below."
        )
        return tour

    top = matches[: min(5, len(matches))]
    # One line per top match: "<invocation> — <description>". User reads
    # both what-to-type and what-it-does in one pass.
    highlights = [
        f"{m['entry']['invocation']} — {m['entry'].get('description') or ''}".strip(" —")
        for m in top
    ]
    suggested = [m["entry"]["invocation"] for m in matches[:6]]

    namespaces_hit = sorted({m["entry"]["namespace"] for m in top})
    namespaces_label = ", ".join("/" + n for n in namespaces_hit)
    summary = (
        f'Top picks for "{_clip(q, 80)}" — focus on {namespaces_label}. '
        "This is a keyword match; for a real natural-language answer, "
        "flip the LLM toggle in the Context Bar."
    )

    return HelpResponseModel(
        available=True,
        llm_used=False,
        model=None,
        summary=summary,
        highlights=highlights,
        suggested_commands=suggested,
        reason_unavailable=reason,
    )


def _catalog_tour(
    catalog: list[dict], question: str, reason: str | None,
) -> HelpResponseModel:
    """The old behavior: group by namespace, pick a handful of reads."""
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
        for s in items:
            if len(suggested) >= 6:
                break
            if s["mode"] == "read":
                suggested.append(s["invocation"])
    summary = (
        f"Slash has {len(catalog)} skills across {len(by_ns)} namespaces. "
        "Ask a specific question (what am I trying to do?) for targeted help, "
        "or turn on the LLM toggle for a natural-language answer."
    )
    return HelpResponseModel(
        available=True,
        llm_used=False,
        model=None,
        summary=summary,
        highlights=highlights,
        suggested_commands=suggested,
        reason_unavailable=reason,
    )


# ── bilingual keyword matcher ─────────────────────────────────────────
# A tiny, SRE-flavored synonym bridge. Not a dictionary; just enough to
# get common zh↔en queries to hit the right English skill descriptions.

SYNONYMS: dict[str, str] = {
    # infra / compute
    "ec2": "vm instance 虚拟机 实例",
    "vm": "ec2 instance 虚拟机 实例",
    "instance": "vm ec2 实例 虚拟机",
    "实例": "vm ec2 instance",
    "虚拟机": "vm ec2 instance",
    # networking
    "vpc": "vpc network 网络",
    "网络": "network vpc netin netout",
    "sg": "security group 安全组",
    "安全组": "sg security group rules",
    "rules": "sg security group 规则",
    "规则": "rules sg security group",
    # storage
    "s3": "bucket 存储",
    "存储": "s3 bucket disk ebs",
    "ebs": "disk volume snapshot",
    # k8s
    "pod": "pod container 容器",
    "容器": "pod container",
    "deploy": "deployment 部署",
    "deployment": "deploy 部署",
    "部署": "deploy deployment",
    "node": "node 节点",
    "节点": "node",
    "cluster": "cluster 集群 kubectl",
    "集群": "cluster",
    "namespace": "ns 命名空间",
    "ns": "namespace 命名空间",
    "命名空间": "ns namespace",
    # verbs / actions
    "status": "status 状态 health",
    "状态": "status get describe",
    "查看": "get describe list show",
    "查": "get describe list show",
    "列出": "list show",
    "show": "show list 显示",
    "logs": "logs 日志 tail",
    "日志": "logs tail",
    "metrics": "metrics 指标 监控 dashboard cloudwatch",
    "监控": "metrics dashboard cloudwatch",
    "指标": "metrics dashboard",
    "events": "events 事件",
    "事件": "events",
    "rollback": "rollback undo 回滚",
    "回滚": "rollback undo",
    "scale": "scale replicas 扩容 副本",
    "扩容": "scale replicas",
    "副本": "replicas scale",
    "restart": "restart 重启 rollout",
    "重启": "restart rollout",
    "delete": "delete 删除",
    "删除": "delete remove",
    "drain": "drain 排水 cordon",
    "audit": "audit 审计",
    "审计": "audit",
    "context": "context 上下文",
    "ctx": "context 上下文",
    "上下文": "ctx context",
    # specific AWS words
    "rds": "rds database 数据库",
    "数据库": "rds database",
    "elb": "elb load balancer 负载均衡",
    "负载均衡": "elb load balancer",
    # k8s diagnostic flow
    "root": "cause reason diagnose",
    "diagnose": "diagnose 诊断 root cause",
    "诊断": "diagnose",
}

_STOP_CJK = set("的了是我你他她它在和就也有这那个个些不吗呢啊要来去把给但是可以他们他们如何怎么怎样请还或但"
                "以所然那只知道现想但是当然因此所以什么哪里哪个为了因为所以如果这些那些我们你们他们如果已经")


def _tokenize(s: str) -> set[str]:
    s = (s or "").lower()
    tokens: set[str] = set()
    # ASCII words ≥ 2 chars
    for m in re.findall(r"[a-z0-9][a-z0-9_\-]+", s):
        tokens.add(m)
    # CJK: bigrams + full runs (plus 3-grams for short phrases like "安全组")
    for run in re.findall(r"[一-鿿]+", s):
        if len(run) >= 2:
            for i in range(len(run) - 1):
                bg = run[i : i + 2]
                if bg[0] in _STOP_CJK and bg[1] in _STOP_CJK:
                    continue
                tokens.add(bg)
            if len(run) <= 6:
                tokens.add(run)
            if len(run) >= 3:
                for i in range(len(run) - 2):
                    tokens.add(run[i : i + 3])
    return tokens


def _expand(tokens: set[str]) -> set[str]:
    out = set(tokens)
    for t in list(tokens):
        syn = SYNONYMS.get(t)
        if syn:
            out.update(syn.split())
    return out


def _skill_haystack(entry: dict) -> str:
    parts: list[str] = [
        entry.get("id", ""),
        entry.get("description", "") or "",
        entry.get("namespace", ""),
        str(entry.get("target") or ""),
        " ".join(entry.get("noun", []) or []),
        entry.get("verb", ""),
    ]
    return " ".join(parts).lower()


def _rank_by_question(catalog: list[dict], question: str) -> list[dict]:
    """Return [{entry, score, hit_tokens}] sorted by score desc, score ≥ 1."""
    tokens = _expand(_tokenize(question))
    if not tokens:
        return []
    ranked: list[dict[str, Any]] = []
    for entry in catalog:
        hay = _skill_haystack(entry)
        if not hay.strip():
            continue
        hits: list[str] = []
        for t in tokens:
            if t and t in hay:
                hits.append(t)
        if not hits:
            continue
        # Prefer reads over writes for exploratory questions (danger: true
        # skills shouldn't be the first thing we suggest when the user just
        # asked "how do I look at X").
        mode_bonus = 0.5 if entry.get("mode") == "read" else 0.0
        # Mild bonus when a hit lands in the id or verb (more specific than
        # a loose description match).
        id_bonus = 0.5 if any(
            t in entry.get("id", "").lower() or t == entry.get("verb", "").lower()
            for t in hits
        ) else 0.0
        score = len(hits) + mode_bonus + id_bonus
        ranked.append({"entry": entry, "score": score, "hits": hits})
    ranked.sort(key=lambda x: (-x["score"], x["entry"]["id"]))
    return ranked


def _clip(s: str, n: int) -> str:
    s = s.strip()
    return s if len(s) <= n else s[: n - 1] + "…"
