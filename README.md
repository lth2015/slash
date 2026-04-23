# Slash

**Single-machine local PoC.** A one-window SRE cockpit: type a strict command, the local runtime runs `bash` on your own machine, writes need your own approval in the same window, and every turn is appended to a local audit file. No server, no SSO, no team features — and that is deliberate.

> Spec-first. Read [`docs/`](./docs/) before touching code — especially:
>
> - [`docs/00-README.md`](./docs/00-README.md) — doc index
> - [`docs/02-commands.md`](./docs/02-commands.md) — the command language
> - [`docs/03-architecture.md`](./docs/03-architecture.md) — how the pieces fit
> - [`docs/05-safety-audit.md`](./docs/05-safety-audit.md) — HITL rules + audit

## Principles

- **Strict DSL only.** Every input is parsed against an EBNF grammar and a Skill registry. If it doesn't parse, it doesn't run. There is no fallback to "what did you probably mean".
- **No natural-language execution.** You can't type "restart the web pods". The LLM (Gemini 2.5 Flash) is used only to summarize or explain results the runtime has already produced — it can never execute, approve, or modify a plan. Its output always carries an `LLM·generated` label.
- **Local-first.** The UI runs in your browser against a FastAPI process bound to `127.0.0.1`. The runtime spawns `aws` / `gcloud` / `kubectl` / `bash` under your own OS user, using credentials already on disk (`~/.aws/credentials`, `~/.config/gcloud`, `~/.kube/config`). Nothing is shipped to a server.
- **Write requires local approval.** Every `mode: write` skill stages a `PlanCard` + `ApprovalCard` in the conversation stream; the bash command does not run until you click Approve in the same window. `danger: true` skills add a typed-YES step and a highlighted rollback hint.
- **Append-only local audit.** Every turn appends one JSONL line to `.slash/audit/audit.jsonl` — timestamp, user, command, parsed AST, skill id, mode, risk, plan summary, approval decision, execution argv, stdout/stderr SHA-256, approver. No rotation, no DB, no external sink. Query it via `/ops audit logs`.

## Non-goals (this phase)

- **No API expansion.** The FastAPI process is a localhost adapter for one browser. Its endpoints are an internal seam, not a public contract; they will not grow into a service, not gain auth layers, not be versioned for external consumers.
- **No database.** State is in-memory + one JSONL file. HITL pending plans live in a dict. If you feel you need Postgres, the cockpit is the wrong layer.
- **No multi-user.** Single OS user, single machine, single browser session. No SSO, RBAC, tenancy, or shared workspace.
- **No orchestration engine.** Skills are atomic — one command maps to one `aws` / `gcloud` / `kubectl` / local-file invocation. There is no DAG, no job scheduler, no retry policy beyond one timeout per skill, no workflow primitives.

## Stack

- **Web** — Next.js 15 · TypeScript · Tailwind · CodeMirror 6 · lucide-react
- **API** (local only) — FastAPI · Python 3.12 · uvicorn
- **Runtime** — `subprocess.run(argv, …)`, never `shell=True`
- **Monorepo** — pnpm workspace (web) · Python venv (api)

## Requirements

- Node ≥ 20 (corepack-enabled)
- Python 3.12
- Git
- Cloud CLIs you plan to use, already authenticated on this machine: `aws` / `gcloud` / `kubectl`

## Quick start

```bash
make setup       # create apps/api/.venv + install pnpm deps
make dev         # or: ./scripts/slash-up
```

Web at http://localhost:4455 · local FastAPI at http://localhost:4456.

## Repo layout

```
slash/
├─ apps/
│  ├─ web/          # Next.js UI — one window, no routing
│  └─ api/          # FastAPI process (bound to 127.0.0.1)
├─ skills/          # Skill YAMLs + bash templates + harness fixtures
├─ scripts/         # dev scripts (slash-up)
├─ .slash/          # local-machine state (gitignored) — audit/audit.jsonl
└─ docs/            # spec-first documentation (read first)
```

## Contributing

Edit docs **before** editing code. If a code change conflicts with a doc, fix the doc first.
