# Slash

**Unified command palette for SRE.** Slash gives SRE one strict, auditable command language across multi-cloud, Kubernetes, applications, and daily ops. Capabilities are shipped as Git-managed Skills with HITL approval and tamper-evident audit.

> Spec-first project. Read [`docs/`](./docs/) before touching code — especially:
>
> - [`docs/00-README.md`](./docs/00-README.md) — doc index
> - [`docs/02-command-reference.md`](./docs/02-command-reference.md) — the command language
> - [`docs/03-architecture.md`](./docs/03-architecture.md) — system architecture
> - [`docs/07-roadmap.md`](./docs/07-roadmap.md) — phased roadmap

## Stack

- **Web**: Next.js 15 · TypeScript · Tailwind · shadcn-style components · CodeMirror 6 (planned in M1).
- **API**: FastAPI · Python 3.12 · SQLite (demo).
- **Monorepo**: pnpm workspace (web) · Python venv (api).

## Requirements

- Node ≥ 20 (corepack-enabled)
- Python 3.12
- Git

## Quick start

```bash
make setup       # creates apps/api/.venv and installs pnpm deps
make dev         # or: ./scripts/slash-up
```

Then open http://localhost:4455. The API is at http://localhost:4456.

## Repo layout

```
slash/
├─ apps/
│  ├─ web/          # Next.js UI
│  └─ api/          # FastAPI backend
├─ packages/        # shared TS packages (empty in M0)
├─ providers/       # cloud / k8s adapters (stubs in M0)
├─ skills/          # Skill definitions (one example in M0)
├─ audit-journal/   # append-only Git audit trail
├─ scripts/         # dev scripts
└─ docs/            # spec-first documentation (read first)
```

## Current milestone

**M0 · Foundation** — scaffolding is in place. `make dev` starts both apps; most endpoints return `Not implemented` with a pointer to the relevant doc section. See [docs/07-roadmap.md](./docs/07-roadmap.md).

## Contributing

Edit docs **before** edit code. If a code change conflicts with a doc, fix the doc first.
