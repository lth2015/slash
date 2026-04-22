# Skills

Each atomic command is one Skill. Directory layout = command tree.
See `docs/04-skills-system.md` for the full spec.

```
skills/
├─ infra/
│  ├─ aws/<noun>.../<verb>/
│  └─ gcp/<noun>.../<verb>/
├─ cluster/
│  └─ _any/<noun>.../<verb>/       # _any = kubeconfig context supplied at runtime
├─ app/<noun>.../<verb>/
└─ ops/<noun>.../<verb>/
```

M0 ships **one example manifest** (`infra/aws/vm/list`) to validate the registry walk.
Real runtime implementations land in M2.
