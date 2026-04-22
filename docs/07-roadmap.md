# 07 · 路线图（Roadmap）

> 目标：**先跑通、再加固、再上规模**。Demo (v0) 证明核心形态；v0.x 补基础广度；v1 进入生产级。路线图只列**要做**的事和**要跑通**的验收，不预设日期。

## 里程碑总览

| 里程碑 | 主题 | 退出条件（代表项） |
| --- | --- | --- |
| M0 · Foundation | 骨架与合约 | 文档冻结 / 仓库结构 / CI 模板就绪 |
| M1 · Parser & Registry | 命令语言可跑 | 全部原子命令能解析出 AST，Skill manifest 加载通过 |
| M2 · Read Skills × 10 | 读能跑通 | `/infra aws vm list`, `/cluster get/list/logs/describe`, `/infra aws cost summary` 等 10 条 read 类端到端 |
| M3 · Write Skills + HITL | 写 + 审批 | `/cluster scale`, `/app rollback`, `/cluster rollout restart` 走完 Plan → Approve → Execute → Audit |
| M4 · UI v0 | 界面可用 | Command Bar / Output / Approvals / Audit Viewer 走查清单通过 |
| M5 · Demo 打磨 | 可以给人看 | 启动脚本一条命令起 demo；README 录屏；设计 audit pass |
| M6 · Hardening | Linux 沙箱 / 签名 | seccomp 沙箱 / GPG 签名 / 审计 hash chain |
| M7 · v1 | 生产级 | SSO (OIDC) / Postgres / 团队空间 / 远程 Agent |

## M0 · Foundation（文档与骨架）

**进入条件**：本 `docs/` 目录六份文档齐备并通过自省（见 [00 索引](./00-README.md)）。

**交付物**：
- `apps/web`, `apps/api`, `providers/*`, `skills/`, `audit-journal/` 目录骨架（仅 stub）。
- `pnpm-workspace`, `uv` 项目；`make dev` / `scripts/slash-up` 空壳能启动到 "Hello Slash"。
- CI：lint + type-check + schema-check 的占位 workflow。
- 依赖清单（pinning）：前端与后端。

**退出条件**：`scripts/slash-up` 能拉起空 UI，点任何功能都导向 `Not implemented` 空状态；所有 PR 触发的 CI 绿灯。

## M1 · Parser & Registry

- 手写 LL(1) 解析器；golden 测试 ≥ 200 合法 + ≥ 200 非法。
- Skill Loader：watch `skills/`，hot-reload；schema 校验。
- Provider Capability Matrix 基础装载（aws/gcp/k8s 空实现）。
- `/parse`, `/completions`, `/skills` 接口完备（`/execute` 为 stub）。
- UI Command Bar：语法高亮 + 补全（仅 Skill registry 本地补全）。

**退出条件**：把 [02 命令参考](./02-command-reference.md) 中所有原子命令敲进 Command Bar，全部得到合法 AST 或清晰 ParseError；补全在本地数据上 ≤50ms。

## M2 · Read Skills × 10

最低要实现（跨三个 Provider）：

1. `/infra aws vm list`（with `--region`, `--tag`）
2. `/infra aws vm get <id>`
3. `/infra aws oss bucket list`
4. `/infra aws cost summary --window 7d`
5. `/infra gcp vm list`
6. `/cluster <ctx> list pod --ns <n>`
7. `/cluster <ctx> get <kind> <name> --ns <n>`
8. `/cluster <ctx> describe pod <name> --ns <n>`
9. `/cluster <ctx> logs <pod> --ns <n> --since 30m`
10. `/ops audit logs --since 1d`

**退出条件**：每个 Skill 有 ≥ 1 happy + ≥ 1 error 测试；UI Output Panel 能按 schema 渲染；`audit_events` 表每步都写记录。

## M3 · Write Skills + HITL

- Executor 的 plan → approve → execute → record 完整实现。
- 审批流：Approval Inbox UI + `POST /approvals/.../decision`。
- 至少实现：
  - `/cluster <ctx> scale <deploy> --replicas N --ns <n> --reason ...`
  - `/cluster <ctx> rollout restart <deploy> --ns <n> --reason ...`
  - `/app rollback <name> --env <env> --reason ...`
  - `/infra aws vm stop <id> --reason ...`
  - `/ops alert ack <id> --reason ...`
- 一条 `danger: true` Skill 作为双审样例：`/infra aws vm backup restore <id> --backup <b>`（可对 mock provider）。

**退出条件**：所有 write 在无 `--yes` 与无审批时正确失败；审批通过后产物可在 Audit Viewer 检索；审计 Git 仓库同步生成 Markdown 摘要。

## M4 · UI v0

按 [06 UI/UX 设计](./06-ui-ux-design.md) 的设计验收清单逐项完成：

- Command Bar / Output Panel / Explain Pane / Approvals Inbox / Skills Browser / Audit Viewer 齐备。
- 快捷键全部工作；A11y 通过 `audit` skill 评估（无严重 / 高危）。
- Dark / Light 两套主题同等打磨。
- 错误文案走 What / Why / How。

**退出条件**：在 1920×1080 与 1366×768 两个视口下无横向滚动；所有页面首屏可键盘操作。

## M5 · Demo 打磨

- `scripts/slash-up` 一条命令：起 kind 集群（或连真集群）、FastAPI、Next.js，并填充种子数据（mock AWS/GCP 数据）。
- README：2 分钟 quickstart + demo 脚本。
- 录屏：从命令补全 → 审批 → 执行 → 审计。
- 内部走查：3 位 SRE 跑一遍 3 个场景（扩容、回滚、故障诊断）。

**退出条件**：外部同事照 README 能在 10 分钟内跑起来并完成一次扩容演示。

## M6 · Hardening（Linux & 生产沙箱）

- Linux 沙箱：seccomp + netns + overlayfs 挂载。
- Skill CI：commit GPG 签名强制；runtime 拒绝未签名。
- 审计 hash chain 持续导出外部存储（S3/GCS）。
- Fuzz：对 Parser 做 1h 连跑；对 `args` schema 做字段 fuzz。
- 性能：Parser P95 < 10ms；补全远程 P95 < 200ms。

## M7 · v1

- **身份**：OIDC（Okta/Google/Azure）+ 组织角色；Skill CODEOWNERS 映射到组。
- **存储**：SQLite → Postgres；审计分区；长尾冷存。
- **多工作区**：每工作区独立 Skill 仓库；共享的 "core" skills。
- **远程执行 Agent**：在目标环境 (VPC / 集群) 运行 agent；主控只下发指令，不直接持凭据。
- **ChatOps 出口**：Slack/Teams 审批卡片（仍只发送/接收结构化 action，不接受自由文本作为命令）。
- **Skill 市场**：公共 registry；签名校验 + 信誉。

## 跨里程碑的"持续做"

- 文档与代码同步：每次变更先改 `docs/`，再改代码。
- 每个新 Skill 至少两类测试（§[04 §5](./04-skills-system.md)）。
- 每次改 Parser 必过 golden 测试 + fuzz。
- 每个页面的设计改动必过 `audit` + `critique` skill 评估并留档。

## 明确不做（整个 Roadmap 范围内）

- **不做** Slash 自己的 IaC 能力（仍让 Terraform/Pulumi 做基建）。
- **不做** 自由自然语言执行入口（AI 只解释、不执行）。
- **不做** 自动化变更决策（没有"AI 自己决定重启服务"）。
- **不做** 绕过 HITL 的"bulk mode"。批量只能通过 runbook 显式编排并每步审批。
