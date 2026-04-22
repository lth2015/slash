# Providers

Adapters that bridge Slash Skills to cloud / Kubernetes APIs. Skills must go
through these; they must not call `boto3`, `google-cloud-*`, or `kubernetes` directly.

See `docs/03-architecture.md` §4 and `docs/04-skills-system.md` §4.

## Layout

```
providers/
├─ _capabilities.yaml   # (noun, verb) support matrix per provider
├─ aws/                 # stub in M0 — real implementation in M2
├─ gcp/                 # stub in M0 — real implementation in M2
└─ k8s/                 # stub in M0 — real implementation in M2
```

Each provider package exposes a `capabilities()` function, a `check_credentials()` helper,
and a typed client interface that Skills consume via `ctx.providers.<name>`.
