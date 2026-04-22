# 03 · 架构

## 1. 总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Web UI (one window)                            │
│  ┌ Context Bar (AWS profile · GCP project · K8s ctx · LLM toggle) ┐  │
│  │                                                                  │  │
│  │ Conversation stream (cards: Plan · Approval · Result · Error)    │  │
│  │                                                                  │  │
│  │                                                                  │  │
│  └ Command Bar (sticky bottom, CodeMirror 6) ─────────────────────┘  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ REST + WebSocket
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          FastAPI Backend                              │
│  /parse → Parser + Skill Registry (loaded from skills/)              │
│  /execute → Runtime (bash) ──► audit.jsonl                           │
│  /approve → HITL (pending plan table)                                │
│  /explain → Gemini 2.5 Flash (read-only summary)                     │
│  /context → AWS profile / GCP / K8s context listing                  │
└────────────┬──────────────────────────┬──────────────────────────────┘
             │                          │
             ▼                          ▼
     ┌───────────────┐         ┌────────────────────┐
     │  Skill files  │         │   local shells     │
     │  skills/…     │         │   aws / gcloud /   │
     │  (yaml+bash)  │         │   kubectl / bash   │
     └───────────────┘         └────────────────────┘
```

## 2. 模块

### 2.1 Web UI（`apps/web`）
一个 Next.js 页面。无路由。组件只剩：
- `ContextBar` — 顶部
- `Conversation` — 中间卡流
- `CommandBar` — 底部 CodeMirror 编辑器（保留 M1 的 token 着色与 parse 反馈）
- 卡片组件：`PlanCard` / `ApprovalCard` / `RunCard`（流式） / `ResultCard`（表格 / JSON / chart）/ `ErrorCard`

**删除**：Sidebar、Home 独立页面、Runs 列表页、Approvals Inbox 页、Skills Browser、Audit Viewer、Explain Pane（合并到 ResultCard 内）。

### 2.2 API（`apps/api`）
FastAPI，接口极简：

| 方法 路径 | 作用 |
| --- | --- |
| `POST /parse` | 文本 → AST / ParseError |
| `POST /execute` | AST + profile 覆盖 → 创建 Run，返回 `run_id`（读类立即执行，写类进入 `awaiting_approval`） |
| `GET /approvals` | 待审批 plan 列表 |
| `POST /approvals/{run_id}/decide` | `approve` / `reject` + 评论 |
| `GET /runs/{run_id}` （WS） | 流式推送 Run 生命周期事件（stdout / stderr / status） |
| `GET /context` | 读本机 `~/.aws/credentials` profiles、`gcloud config configurations list`、`kubectl config get-contexts` |
| `POST /explain` | 接收 Run 结果，返回 LLM 摘要（仅 read 类） |
| `GET /audit?…` | 过滤 `audit.jsonl`（给 `/ops audit logs` 用） |

### 2.3 Skill Registry
启动时扫 `skills/` 目录加载 YAML（见 [04](./04-skills.md)）。本地改 YAML 即生效（重启 API 或文件变更触发 reload）。

### 2.4 Runtime（bash 执行器）
关键数据流：

1. `AST + skill` → `BashBuilder` 渲染出**参数化的 argv 数组**（不是 shell 字符串拼接）。
2. 建立子进程，注入 profile 环境：
   - AWS：`AWS_PROFILE=<name>`，`AWS_REGION=<region>`（如命令带）
   - GCP：`CLOUDSDK_ACTIVE_CONFIG_NAME=<name>`
   - K8s：`KUBECONFIG=<path>`（多文件合并时） + `--context` 显式传入
3. 子进程用 `subprocess.run([...], env=…, timeout=…, capture_output=True)`，**参数以 list 传给 `argv`，不走 shell**。
4. stdout / stderr 流回 WebSocket。
5. 进程退出 → 解析 `output.parse`（`json` / `text` / `lines`）→ Result 卡。
6. 追加一条 audit 记录（见 [05](./05-safety-audit.md)）。

**关键：没有 shell 字符串拼接，只有 argv 数组传入 subprocess，避免命令注入。**

### 2.5 LLM 集成（Gemini 2.5 Flash）
唯一调用入口：`POST /explain`。

- 请求：Run 的结构化输出（JSON）+ 用户的命令 AST + "summary" 或 "diagnose" 目标。
- System prompt 固定：见 [05 §3](./05-safety-audit.md)。
- **LLM 不能返回可执行命令**，只能返回 markdown 摘要 + 结构化 findings。
- 任何返回都被标注 `LLM·generated`，在 UI 卡上以不同底色呈现。

调用失败 → Result 卡正常显示原始结果，LLM 摘要位置显示 `[LLM unavailable, raw result above]`。

### 2.6 HITL Engine
内存表 `pending_plans: dict[run_id, PendingPlan]`。

流程：
1. `/execute` 若 skill `mode == "write"` → 生成 plan（调用 bash `dry-run` 或从 skill 的 plan 模板渲染 diff）→ 入 pending 表 → 返回 `run_id` & `awaiting_approval`。
2. Approval 卡出现在对话流中（WS 推送）。
3. `/approvals/{id}/decide approve` → 正式执行；`reject` → 标记 rejected，不执行。
4. 一个 plan 只能被决策一次。

### 2.7 审计
单文件 `var/audit.jsonl`。每行 JSON：
```json
{"ts":"2026-04-22T10:15:31Z","user":"local","run_id":"r_01","command":"/infra aws vm list --region us-east-1","skill_id":"infra.aws.vm.list","mode":"read","state":"ok","stdout_sha256":"…","summary":"found 7 instances"}
```
字段在 [05 §4](./05-safety-audit.md) 规范。

## 3. 技术栈

| 层 | 选型 | 备注 |
| --- | --- | --- |
| 前端 | Next.js 15 · TypeScript · Tailwind · CodeMirror 6 · lucide-react | 删除 shadcn 复杂 primitives；单页面 |
| 后端 | Python 3.12 · FastAPI · uvicorn | 保留 |
| LLM | Google Gemini 2.5 Flash via `google-generativeai` SDK | 通过 `GEMINI_API_KEY` env |
| 执行 | `subprocess.run(argv, …)` | 绝不 `shell=True` |
| 审计 | JSONL append | `var/audit.jsonl` |
| 存储 | 内存 + JSONL | 无数据库 |
| 字体 | Geist Sans + Geist Mono | 保留 |

## 4. 仓库结构（大幅精简）

```
slash/
├─ apps/
│  ├─ web/
│  │  ├─ app/page.tsx              # 唯一页面
│  │  ├─ components/
│  │  │  ├─ ContextBar.tsx
│  │  │  ├─ Conversation.tsx
│  │  │  ├─ CommandBar.tsx         # CodeMirror 6（保留）
│  │  │  ├─ cards/
│  │  │  │  ├─ PlanCard.tsx
│  │  │  │  ├─ ApprovalCard.tsx
│  │  │  │  ├─ RunCard.tsx         # 流式 stdout/stderr
│  │  │  │  ├─ ResultCard.tsx      # table/json/chart + optional LLM summary
│  │  │  │  └─ ErrorCard.tsx
│  │  │  └─ editor/                # 保留 M1 tokens + theme
│  │  └─ lib/cn.ts
│  └─ api/
│     ├─ slash_api/
│     │  ├─ main.py
│     │  ├─ routers/               # parse / execute / approvals / context / explain / runs / audit
│     │  ├─ parser/                # 保留
│     │  ├─ registry/              # 保留
│     │  ├─ runtime/               # ★ 新：bash 执行器
│     │  ├─ llm/                   # ★ 新：Gemini 客户端 + system prompt
│     │  ├─ hitl/                  # ★ 新：pending_plans 管理
│     │  └─ audit/                 # ★ 新：jsonl 追加器
│     └─ tests/
├─ skills/
│  ├─ infra/aws/vm/{list,get}/     # yaml + bash + tests
│  ├─ infra/gcp/vm/list/
│  ├─ cluster/_any/{list,get,logs,scale,rollout-restart}/
│  └─ ops/{audit,diagnose}/
├─ scripts/
│  └─ slash-up
├─ var/
│  └─ audit.jsonl                  # 运行时追加
└─ docs/                           # 6 份：README + 01..06
```

**去掉**：`audit-journal/`（Git 仓库，太重）、`providers/`（冗余，已合并到 skill 的 bash 模板里）、`packages/`（空，先不做）。

## 5. 关键流程

### 5.1 Read 命令
```
User types /infra aws vm list --region us-east-1 [Enter]
→ /parse                                 (client-side token coloring + server validation)
→ /execute                               (runtime spawns `aws ec2 describe-instances ...`)
→ WS stream                              (progress dots in RunCard)
→ Runtime parses stdout as JSON          (ResultCard with a table)
→ If Context Bar LLM toggle = ON:
    → /explain                           (Gemini 2.5 Flash summary)
    → ResultCard shows summary below table, badge "LLM·generated"
→ audit.jsonl append
```

### 5.2 Write 命令
```
User types /cluster prod scale web --replicas 10 --ns api --reason "launch" [Enter]
→ /parse ok, mode=write
→ /execute                               (builds plan; does NOT run kubectl)
   returns run_id, state=awaiting_approval
→ ApprovalCard appears in stream
   - shows before/after diff (replicas 4 → 10)
   - [Approve] [Reject (reason required)]
→ User clicks Approve
→ /approvals/{id}/decide approve
→ Runtime spawns kubectl scale
→ WS stream → ResultCard
→ audit.jsonl append (with approver, approval_ts)
```

### 5.3 Danger 命令
Skill 声明 `danger: true` → ApprovalCard 顶部红色横条 + 二次确认（打字输入 YES 才能点 Approve）。

## 6. 配置

环境变量（启动时读）：

| Var | 默认 | 作用 |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | 不设即禁用 LLM 摘要 |
| `SLASH_AUDIT_PATH` | `var/audit.jsonl` | 审计文件路径 |
| `SLASH_SKILLS_DIR` | `skills/` | Skill 目录 |
| `SLASH_DEFAULT_AWS_PROFILE` | `default` | Context Bar 启动默认 |
| `SLASH_DEFAULT_KUBE_CONTEXT` | — | 留空则读 `kubectl config current-context` |
| `SLASH_LLM_DEFAULT` | `off` | LLM 摘要默认开关 |

配置文件：`~/.config/slash/config.toml`（若存在覆盖 env）。
