# 05 · 安全与审计（Security & Audit）

> Slash 的用户是"能把生产搞挂的人"。本文件定义威胁模型、输入净化、HITL、审计链路与最低合规基线。本文件是**可接受风险**的边界；越界的实现一律回退。

## 1. 威胁模型

| 威胁 | 动机 / 来源 | 后果 | 缓解（见对应章节） |
| --- | --- | --- | --- |
| T1 · 输入注入 | 恶意/失误用户把 shell 语义塞进命令 | 任意代码执行、数据泄漏 | §2 输入净化、§3 解析器硬化 |
| T2 · Prompt 注入 | AI 辅助里把用户/外部文本当指令 | 绕过 HITL、扩大权限 | §2.3 AI 边界、§4 HITL |
| T3 · 未授权变更 | 权限蔓延、共享凭据 | 误删资源、配置漂移 | §4 HITL、§5 Capability、§6 审计 |
| T4 · 凭据泄漏 | Skill 打日志、审计泄漏 | 云账号被盗 | §5 凭据管理、§6 日志净化 |
| T5 · Skill 供应链 | 恶意 Skill 合入 | 后门、静默变更 | §7 Skill 治理、CI 签名 |
| T6 · 审计抵赖 | 有人事后改记录 | 失去追溯能力 | §6 审计追加写 + Git 不可逆 |
| T7 · 沙箱逃逸 | Skill 绕过限制做禁用操作 | RCE、数据外带 | §8 沙箱分层 |
| T8 · 可用性 | 误操作或恶意 DoS | 生产不可用 | §9 限流、配额、回滚 |

## 2. 输入净化

### 2.1 命令文本

- **唯一入口**是 Parser（[02 §2](./02-command-reference.md)）。UI 不自己拼命令字符串提交到后端；把 AST 提交。
- Parser 对 token 做白名单字符集；`|`, `&`, `;`, `` ` ``, `$()`, 换行一律 `ParseError`。
- quoted_string 不做变量展开、不解 escape 序列；反斜杠仅用于转义 `"`。
- 文件引用（`--file <path>`）只允许相对 `ctx.workdir` 或白名单目录；绝对路径到 `/etc`, `/root`, `~/.ssh` 等一律拒绝。

### 2.2 参数值

- 每个 Skill manifest 的 `args` schema 是**强类型**（string/int/bool/duration/enum/ref/map），不在列 → 拒绝。
- `ref`（`@secret/...`, `@env/...`）不会被 UI 显示的值替换，进入 Executor 时才解引用，且**只返回句柄，不返回明文**（§5）。

### 2.3 AI 边界

- AI 只出现在三处：
  1. **Explain Pane**（解释命令语义）；输入 = 当前 AST（结构化），**不把用户原文喂给 LLM**。
  2. **诊断 Skill**（`*.diagnose / predict / optimize`）；输出 Markdown 报告，无副作用能力。
  3. **补全提示的自然语言 summary**（可选，default off）。
- 任何 LLM 返回的**文本**都不会被 Executor 当作命令；Executor 只接收来自 UI 的已解析 AST。

## 3. 解析器硬化

- 语法在 [02 §2](./02-command-reference.md) 严格定义；实现必须有对应的**语法 golden 测试集**（合法与非法各 ≥ 200 例）。
- Fuzz 测试：随机字节序列 1M 输入不得触发异常以外的行为（无 crash、无 hang、无内存爆）。
- 错误信息**不回显用户输入的敏感片段**，只指出 token 偏移与类型。
- 解析器无递归深度上的歧义；不支持宏展开。

## 4. Human-in-the-Loop（HITL）

### 4.1 基本原则

- 一切写操作默认**需要审批**。
- **审批 ≠ `--yes`**：`--yes` 仅在 API/CLI 无 UI 会话时作为用户的显式意图确认，仍写审计；但 `danger: true` 的 Skill 即便 `--yes` 也要求有另一个真实用户作为审批人。
- 审批人 ≠ 发起人（除非 Skill 显式 `self_approve: true` 且 `risk: low`）。

### 4.2 审批决策表

| Skill `mode` | `danger` | `approvers` | 默认策略 |
| --- | --- | --- | --- |
| read | — | — | 无需审批 |
| write | false | 1 | 一人审批 |
| write | true | ≥ 2 | 双人审批；第二人签字前不可执行；两个人必须不同 |

### 4.3 审批载体

- Plan 内容包括：命令文本、AST、effects diff（before/after）、warnings、trace_id、发起人、时间。
- UI 中审批页面显示 diff；大体量 diff 支持折叠/搜索/copy。
- 审批决定（approve/reject）带 `comment` 入审计。

### 4.4 变更窗口 & 冻结

- 可配置 **冻结窗口**（如节假日 / 大促前 2h）：命中时所有 write 类自动加审批 + 额外 `risk_elevation` 原因。
- `/ops incident open` 以上的事件可在短时间内**提升**权限（emergency override），但全程审计并事后回查。

## 5. 凭据与 Secret

- **不自建**凭据存储。凭据来源：
  - AWS：`~/.aws/credentials`, `AWS_PROFILE`, `AWS_*` env.
  - GCP：`gcloud auth application-default`, `GOOGLE_APPLICATION_CREDENTIALS`.
  - K8s：`~/.kube/config`。
- Skill 代码永远**拿不到原始凭据**，只能通过 provider client 调用。
- `@secret/<name>` 是外部 Secret Manager 的引用：
  - Slash 只校验"存在"（metadata 读）；
  - 值在 provider 层按需获取并直接注入到目标系统（例如 K8s Secret 对象），**不途经 Skill 代码、不写审计明文**。
- 在审计与日志里，凭据/`@secret`、`Authorization` 头、bearer token、连字符邮箱等都会被 `[REDACTED]` 正则替换（多层 pipeline 兜底）。

## 6. 审计链路

### 6.1 事件类型

| 事件 | 时机 | 字段（节选） |
| --- | --- | --- |
| `parse` | 命令被成功/失败解析 | text, user, result, trace_id |
| `plan` | plan 生成 | plan_id, effects, warnings |
| `approve` | 审批裁决 | plan_id, decided_by, decision, comment |
| `execute` | 开始执行 | run_id, skill_id, skill_commit |
| `result` | 执行结束 | run_id, state, error?, duration |

### 6.2 存储

- 一级存储：SQLite `audit_events`（append-only；触发器禁止 UPDATE/DELETE，违反 → 失败）。
- 二级存储：每次 write 结束后，生成 Markdown 摘要并 commit 到 `audit-journal` 仓库（可推远端）；commit message 含 `run_id`。
- 双重记录的原因：DB 查得快，Git 改不了（signed commits in v1）；二者不一致即 tamper 告警。

### 6.3 查询与保留

- `/ops audit logs` 命令支持按 user / command / resource / time / run_id / skill_id 过滤。
- 默认保留：demo 本地 90 天；生产 ≥ 1 年（合规要求按环境覆盖）。

### 6.4 不可抵赖

- SQLite 启用 `journal_mode=WAL` + `secure_delete=ON`；定期导出 hash chain（每个事件含前一事件的 hash）到外部对象存储。
- 任何人（含运维）都不能"只改记录不留痕"：修改本身在 Git 二级审计里留下 commit。

## 7. Skill 治理（供应链安全）

- Skill 仓库 `CODEOWNERS` 分层评审；`danger: true` 必须至少 2 个 owner 评审。
- CI 必须通过（§ [04.3.1](./04-skills-system.md)）；CI 失败不允许合入。
- v1 阶段要求 commit **GPG 签名**且在组织 keyring；未签名 commit 的 Skill 在 runtime 拒绝加载。
- 每次 run 记录 `skill_commit_sha`；若 Skill 被回滚，历史 run 仍指向当时的 commit（审计可重放）。

## 8. 沙箱分层

| 层 | 控制 | Demo（macOS） | v1（Linux） |
| --- | --- | --- | --- |
| L0 语言级 | 禁用 import / 禁用 eval；静态扫描 | ✅ | ✅ |
| L1 进程级 | 独立子进程、超时、内存/CPU 限额 | ✅ | ✅ |
| L2 文件级 | 只读挂载；workdir 临时目录 | chroot 不可，走 path jail | bind mount + overlayfs |
| L3 网络级 | 只允许 provider client | 进程内 monkeypatch + 启动时 scan | seccomp + netns |
| L4 凭据级 | 不透给 Skill，provider 内部注入 | ✅ | ✅ |

Demo 明确声明：**macOS 版本非生产沙箱等级**，只防误用不防恶意；仅在内网 demo 使用。生产版（v1）走 Linux + seccomp。

## 9. 可用性与反 DoS

- Parser / Executor 的单用户 QPS 软限（token bucket）。
- 单 run 有 `timeout`；超时 → 发送 provider 层的 cancel。
- 长流式命令（`logs --follow`）按连接数限；断连即释放。
- 误操作兜底：对 write 的 Skill，Plan 对受影响目标数量有上限（例：`cluster scale` 单次只能改一个 deploy；跨 deploy 批量必须走 `runbook`）。

## 10. 事件响应（IR）

- 发现异常（如 tamper hash 不符、沙箱逃逸信号）→ 自动 freeze：registry 停止加载新 Skill、Executor 只允许 read。
- `/ops incident open --severity critical` 会自动附加当前 freeze 状态到事件单。
- 事后 review 通过后，由 CODEOWNERS 批准解除 freeze。

## 11. 合规映射（参考）

- **SOC2 CC7 变更管理**：GitOps + PR 审批 + 不可抵赖审计。
- **ISO 27001 A.12.4 日志**：append-only + 保留策略。
- **最小权限**：每个 Skill 的 capability 白名单；provider 凭据**不交给** Skill。

## 12. 自我治理

- Slash 自己的配置变更（如"冻结窗口"规则）也走 Skill 化的命令（`/ops policy set ...`），不允许在 UI 或 DB 里"偷偷改"。
- 这条递归治理让 Slash 的安全策略本身**可审计、可回滚**。
