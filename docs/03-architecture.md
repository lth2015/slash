# 03 · 架构（Architecture）

> 本文件是 Slash 的系统架构蓝图。任何代码结构、技术选型、接口定义须与本文件一致；若冲突，必须先修文档，再改代码。

## 1. 架构总览

```
                    ┌──────────────────────────────────────────────┐
                    │                 Web UI (Next.js)              │
                    │  Command Bar · Explain Pane · Approval Inbox  │
                    │  Audit Viewer · Skill Browser · Output Panel  │
                    └────────────────┬──────────────┬──────────────┘
                                     │ HTTPS (JSON) │ WebSocket (log/plan stream)
                                     │              │
                    ┌────────────────┴──────────────┴──────────────┐
                    │                  API Gateway                  │
                    │  auth (OS user) · rate-limit · request-id     │
                    └────────────────┬──────────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
┌───────▼────────┐          ┌────────▼────────┐          ┌────────▼────────┐
│   Parser &     │          │   Executor &    │          │   Audit &        │
│   Validator    │──AST────▶│   HITL Engine   │──events─▶│   Git Recorder   │
│  (EBNF, types) │  Plan    │  (sandbox)      │          │  (SQLite + Git)  │
└───────┬────────┘          └────────┬────────┘          └──────────────────┘
        │                            │
        │                  ┌─────────▼──────────┐
        │                  │  Skill Registry &   │
        └─────metadata────▶│  Loader (hot-reload)│
                           └─────────┬──────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  │                  │                  │
         ┌────────▼──────┐  ┌────────▼──────┐  ┌────────▼──────┐
         │  Provider:    │  │  Provider:    │  │  Provider:    │
         │  aws (boto3)  │  │  gcp (google- │  │  k8s (kube-   │
         │               │  │   cloud-*)    │  │   client)     │
         └───────────────┘  └───────────────┘  └───────────────┘
```

## 2. 模块职责

### 2.1 Web UI（apps/web）
Next.js 15 App Router + TypeScript。只做展示与编排，不含业务逻辑。
- **Command Bar**：CodeMirror 6 编辑器，命令语法高亮 + 补全 + 错误标注。
- **Explain Pane**：右侧栏，AI 解释当前命令语义、将要发生的副作用；**只读、不执行**。
- **Approval Inbox**：HITL 队列，查看 Plan、批/驳、评论。
- **Output Panel**：按 Skill 的 output schema 渲染（table/object/log/report）。
- **Skill Browser**：浏览 Skill 目录、manifest、历史。
- **Audit Viewer**：按 user / command / resource / time 查询。

### 2.2 API Gateway（apps/api · FastAPI）
- **身份**：demo 从 `X-Slash-User` header 读（由本地代理注入），prod 接 OIDC。
- **接口**（REST + WS）：
  - `POST /parse` { text } → { ast | parseError, skill, needsApproval }
  - `POST /plan` { ast } → { planId, effects[], warnings[] }
  - `POST /execute` { planId, approvedBy? } → { runId }（WS 推流）
  - `WS /runs/{runId}` → { event } 流
  - `GET /completions?cursor=...&text=...` → { items[] }
  - `GET /skills` / `GET /skills/{id}`
  - `GET /audit` / `GET /audit/{id}`
  - `GET /approvals` / `POST /approvals/{planId}/decision`

### 2.3 Parser & Validator
- 手写 LL(1) 解析器（避免引入 PEG 依赖的魔法），输出 `CommandAST`。
- 类型绑定基于目标 Skill 的 `args` schema。
- Golden test：每条原子命令至少 1 合法 + 2 非法样本。

### 2.4 Skill Registry & Loader
- 启动时递归扫描 `skills/`，加载 `skill.yaml` manifest。
- Watch 文件变动，hot-reload（保持执行中的 run 不中断）。
- 按 `namespace / noun / verb` 索引；同 key 不允许重复，冲突报错并拒绝启动。
- 验证 manifest schema、签名（v1 阶段）、capability 合法性。

### 2.5 Executor & HITL Engine
- 每次执行分阶段：`parse → plan → (approve?) → preflight → execute → record`。
- Plan 阶段调用 Skill 的 `plan()` 入口，不改变外部状态；收集 `effects`（结构化描述 "会发生什么"）。
- HITL 判定：
  - 纯 read → 无须审批。
  - write → 需要审批（`--yes` 在 CLI/API 模式下允许，UI 强制审批）。
  - 高危（标记 `danger: true` 的 Skill，如 `vm backup restore`, `db backup restore`, `cluster exec`, `oss object delete`）→ **双人审批**。
- 沙箱：每个 Skill 在独立 Python 子进程中执行，通过受限的 Provider SDK 与外部通信；禁止 `subprocess`, `socket` 外部库直连。

### 2.6 Audit & Git Recorder
- 所有事件（parse/plan/approve/execute/result）写 SQLite `audit_events`（append-only）。
- 每次 write 类 run 完成后，生成 Markdown 摘要并 commit 到 `audit-journal/` Git 仓库（可推远端）。
- Skill 的每次变更也走 Git（Skill 仓库本身）；`run` 记录会附带 `skill_commit_sha`。

### 2.7 Provider 层
- 每个 Provider 是独立包：`providers/aws`, `providers/gcp`, `providers/k8s`。
- **Capability Matrix**：在 `providers/_capabilities.yaml` 声明每个 Provider 支持的 `(noun, verb)`；不支持则由 Executor 在 preflight 阶段返回 `UnsupportedOperation`。
- Provider 封装凭据获取：从标准位置读（`~/.aws/credentials`, `~/.config/gcloud`, `~/.kube/config`），**不自建凭据存储**。

## 3. 技术选型

| 层 | 选型 | 理由 | 备选 |
| --- | --- | --- | --- |
| 前端框架 | Next.js 15 (App Router) | SSR/RSC 成熟、生态 | Remix |
| UI 库 | shadcn/ui + Tailwind | 高定制、无运行时锁定 | Radix 原生 |
| 编辑器 | CodeMirror 6 | 语法高亮 + 补全 API 清晰 | Monaco |
| 日志流 | xterm.js | 终端语义、ANSI 支持 | 自研 |
| 后端语言 | Python 3.12 + FastAPI | 云/K8s/AI SDK 最全 | Go + Echo |
| 任务执行 | asyncio + 子进程沙箱 | 对 IO 密集命令友好 | Celery（过重） |
| 数据库 | SQLite（v0）→ Postgres（v1） | demo 零依赖 | DuckDB |
| 包管理 | pnpm（web）、uv（api） | 快、确定性 | npm / poetry |
| Skill 存储 | Git | 天然版本/审计 | 对象存储 |
| 通信 | REST + WebSocket | 流式输出必需 | SSE |
| 进程管理 | `slash` CLI 启前后端 | 单命令即 demo | docker-compose |

## 4. Provider 抽象

```python
# providers/base.py
class Provider(Protocol):
    name: str                      # "aws" | "gcp" | "k8s"
    def capabilities(self) -> set[tuple[str, str]]: ...  # {(noun, verb), ...}
    def check_credentials(self) -> CredCheckResult: ...
    # Skill 通过 provider client 访问资源，不得直调 SDK
```

**Capability Matrix 示例：**
```yaml
# providers/_capabilities.yaml
aws:
  - [vm, list]
  - [vm, get]
  - [vm, start]
  - [vm, stop]
  # vm.resize yes, oss.object.* yes ...
gcp:
  - [vm, list]
  - [vm, get]
  - [vm, start]
  - [vm, stop]
  # dns.record.resolve unsupported here because gcp equivalent requires different auth
k8s:
  - [pod, get]
  - [pod, logs]
  - [deploy, scale]
```

**跨 Provider 语义约束**：同一 `(noun, verb)` 在不同 Provider 下输出字段须一致（由 Skill output schema 保证），不一致时应新开 verb 而不是偷偷塞字段。

## 5. 数据模型（核心表）

SQLite 表（后续可换 Postgres）：

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,          -- "infra.aws.vm.list"
  namespace TEXT, noun TEXT, verb TEXT,
  provider TEXT,                 -- null 表示跨 provider
  manifest_json TEXT NOT NULL,
  version TEXT NOT NULL,
  git_commit TEXT NOT NULL,
  danger INTEGER NOT NULL DEFAULT 0,
  loaded_at TIMESTAMP NOT NULL
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  command_text TEXT NOT NULL,
  ast_json TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  skill_commit TEXT NOT NULL,
  state TEXT NOT NULL,           -- parsed|planned|awaiting_approval|approved|running|done|failed|rejected
  reason TEXT,
  trace_id TEXT NOT NULL,
  started_at TIMESTAMP,
  ended_at TIMESTAMP
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  effects_json TEXT NOT NULL,    -- [{target, before, after, kind}]
  warnings_json TEXT,
  created_at TIMESTAMP
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  decided_by TEXT,
  decision TEXT,                 -- approved|rejected
  comment TEXT,
  decided_at TIMESTAMP
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  kind TEXT NOT NULL,            -- parse|plan|approve|execute|result
  payload_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_runs_user_time ON runs(user, started_at);
CREATE INDEX idx_audit_run ON audit_events(run_id);
```

## 6. 关键流程

### 6.1 Read 命令：`/infra aws vm list --region us-east-1`

```
UI Command Bar
  → POST /parse
      → Parser → AST
      → Skill registry resolve "infra.aws.vm.list"
  → POST /plan  (skill.plan())
      → 返回 effects = []（read 类）
  → POST /execute   （HITL 跳过）
      → Executor 启沙箱子进程运行 skill.run()
      → Provider `aws` 调 boto3 describe_instances
      → 流式返回行，UI 按 table schema 渲染
  → 写 audit_events: parse, plan, execute, result
```

### 6.2 Write 命令：`/cluster prod scale web --replicas 10 --ns api --reason "..."`

```
Parse → Plan
  plan() 返回 effects = [{
    target: "deploy/web@prod/api",
    before: {replicas: 4},
    after:  {replicas: 10},
    kind:   "scale"
  }]
→ 提交审批（除非 --yes 且用户有 policy.auto_approve）
  UI 推送到 Approval Inbox，审批人看到 diff
→ 审批通过 → preflight（权限、依赖）→ execute
→ commit Markdown 摘要到 audit-journal repo
```

### 6.3 双人审批：`/infra aws vm backup restore <id> --backup <b>`

Skill 声明 `danger: true, approvers: 2`。Planner 生成 plan 后，UI 要求两个不同用户先后批准，第二人签字后才进入执行。

## 7. 仓库结构

```
slash/
├─ apps/
│  ├─ web/                 # Next.js UI
│  │  ├─ app/
│  │  ├─ components/
│  │  └─ lib/
│  └─ api/                 # FastAPI
│     ├─ slash_api/
│     │  ├─ main.py
│     │  ├─ routers/
│     │  ├─ parser/
│     │  ├─ executor/
│     │  ├─ registry/
│     │  ├─ audit/
│     │  └─ schemas/
│     └─ tests/
├─ packages/
│  ├─ shared-types/        # TypeScript 类型（从 OpenAPI 生成）
│  └─ skill-sdk/           # Python SDK for skill authors
├─ providers/
│  ├─ _capabilities.yaml
│  ├─ aws/
│  ├─ gcp/
│  └─ k8s/
├─ skills/                 # Skill 仓库（独立 Git 也可）
│  └─ infra/aws/vm/
│     ├─ list/
│     │  ├─ skill.yaml
│     │  └─ run.py
│     └─ ...
├─ audit-journal/          # 审计 Git 仓库（可 submodule）
├─ docs/                   # 本文件所在
└─ scripts/
   └─ slash-up             # 一键起 demo
```

## 8. 非功能性需求（NFR）

| 维度 | 指标（v0 / Demo） |
| --- | --- |
| 启动时间 | `slash up` 到 UI 可用 ≤ 5s |
| 命令解析 P95 | ≤ 10ms |
| 补全响应 P95 | ≤ 50ms（本地），≤ 200ms（涉及 Provider 远程查询） |
| 日志流延迟 | ≤ 300ms（从远端到 UI） |
| 并发 run | ≥ 20（demo 机器） |
| 崩溃恢复 | 执行中的 run 进程崩溃 → 标 `failed`，不污染审计链 |

## 9. 可观测性

- **Self-tracing**：每个请求带 `trace_id`，审计事件相互关联。
- **结构化日志**：JSON lines，`logger = get_logger("slash.<module>")`。
- **内部指标**：Prometheus `/metrics` 暴露 parse/plan/execute 的 latency 与 error rate（demo 可关闭）。
- **面板**：UI 自带 `/ops slo status slash` 展示自身 SLO。

## 10. 依赖与外部接口

| 依赖 | 用途 | 失败处理 |
| --- | --- | --- |
| AWS API (boto3) | `/infra aws *` | `UnsupportedOperation` / 透传原错误 |
| GCP API | `/infra gcp *` | 同上 |
| Kubernetes API | `/cluster *` | context 不可用 → 明确拒绝 |
| 本地 Git | Skill 仓库 / 审计仓库 | 缺失 → 启动失败 |
| 浏览器 | UI 承载 | 无可用浏览器 → CLI fallback（v1） |

## 11. 构建与发布

- `pnpm build`（web）+ `uv build`（api）→ 单容器镜像（v1）。
- Demo：`./scripts/slash-up` 同时启动 web 与 api，浏览器自动打开 `http://localhost:4455`。
- 所有组件版本在 `VERSION` 文件，审计记录中带版本号。
