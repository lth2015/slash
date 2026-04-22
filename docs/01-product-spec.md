# 01 · 产品规格（PRD）

## 1. 一句话定位

**Slash** 是面向 SRE 的统一命令面板：用一套命令式、原子化、可审计的语言，指挥多云基础设施、Kubernetes 集群、应用交付与日常运维；所有能力以 Skill 形态可插拔、版本化、可回滚。

## 2. 背景与动机

SRE 今天的工作面是**碎片化**的：
- 多云：AWS / GCP / 阿里，每家 Console 与 CLI 概念不一致。
- 多系统：云平台、K8s、CI/CD、监控、日志、告警、成本平台各自为政。
- 多工具：`aws`, `gcloud`, `kubectl`, `helm`, `terraform`, 自研脚本……上下文切换成本高。
- 自动化风险：AI 助手 / ChatOps 带来自然语言执行的诱惑，但**生产变更不可容忍模糊性与 Prompt 注入**。

Slash 的目标是回到**确定性**：命令即契约，Skill 即能力，审计即合规。AI 可以辅助*发现*和*解释*，但**执行**必须通过形式化命令。

## 3. 目标用户（Personas）

| 角色 | 关心什么 | 反感什么 |
| --- | --- | --- |
| **SRE / DevOps 工程师** | 一致的操作接口、快速定位、可回滚 | 切工具、写重复脚本、被 GUI 卡工作流 |
| **值班工程师（On-call）** | 告警应对速度、降噪、一键执行 Runbook | 被迫现场写命令、找 wiki、找 Console |
| **平台 / 工具团队** | 能复用、能下发能力给业务团队 | 用户跑野脚本、无审计 |
| **SecOps / 合规** | 变更可追溯、权限可约束、敏感操作有审批 | 无痕执行、绕过审批 |

Demo 阶段主要验证前两类用户的体验。

## 4. 产品目标（Objectives）

- **O1 — 统一接口**：`/infra /cluster /app /ops` 四个顶层命名空间覆盖 SRE 90% 的日常操作。
- **O2 — 原子化**：每条命令只做一件事，可组合、可脚本化、可 diff。
- **O3 — 确定性输入**：EBNF 级别可解析，禁止自然语言、禁止 Prompt 注入。
- **O4 — 可审计可回滚**：每次变更都有 Plan、Approval、Effect、Audit 四段记录。
- **O5 — 可扩展**：Skill 是独立文件 + Git 管理；新增能力不改主程序。
- **O6 — 顶级 UX**：命令补全、参数提示、错误解释、结果格式化达到一线 SaaS 商业产品水准。

### 非目标（Non-Goals）— Demo 阶段

- 不实现 SSO / RBAC（见 §6）。
- 不做多租户、多集群编排平台。
- 不做 Terraform 替代品：Slash 做运行时运维操作，不做 IaC 基建描述。
- 不做 AIOps 自动决策引擎：AI 只在 `diagnose/predict/optimize` 提供建议，不自动执行变更。

## 5. 成功标准（Acceptance Criteria）

Demo 被认为"跑通"需满足：

- [ ] 解析器能对 [02 命令参考](./02-command-reference.md) 中列出的 **全部原子命令**返回 AST 或明确的 `ParseError`，无二义性。
- [ ] 至少实现 3 个 Provider：`aws`（boto3 mock）、`gcp`（gcloud SDK mock）、`k8s`（kubernetes-client against kind cluster）。
- [ ] 至少 10 个原子 Skill 可端到端跑通（见 [07 路线图](./07-roadmap.md) 的 Milestone 2 列表）。
- [ ] 所有**写操作**必经 Plan → Approve → Execute → Audit 四段，`--dry-run` 可单独产出 Plan 而不执行。
- [ ] UI 支持：命令补全（token 粒度）、参数提示（类型 + 枚举 + 来源）、错误高亮定位、输出按 Skill 声明的 schema 渲染（表格 / JSON / 日志流）。
- [ ] 审计日志可按 `user / command / resource / time` 查询，并与 Skill 仓库的 Git commit 关联。
- [ ] 设计评审：在 [06 UI/UX](./06-ui-ux-design.md) 的关键页面上通过 `audit` skill 的无"严重/高危"项。

## 6. 范围（Scope）

### 6.1 Demo 阶段范围（v0）

**In scope：**
- 四个命名空间的命令解析与核心 Skill（约 15–20 条）。
- 本地单用户（身份 = 当前 OS 用户），无 SSO。
- 本地 SQLite 做审计与会话存储。
- Skills 存在本地 Git 仓库，变更即 commit。
- Web UI（本地 `slash up` 起 server + 打开浏览器）。

**Out of scope：**
- SSO / 多用户 / RBAC / 多租户。
- 分布式部署、HA、跨区域同步。
- 内置 Secret 管理：凭据从环境变量与 `~/.aws`, `~/.config/gcloud`, `~/.kube` 直接读取。
- 计费、配额、节流（仅 token 级限流保护后端）。

### 6.2 v1 阶段范围

在 v0 基础上新增：SSO（OIDC）、团队工作区、审计后端换 Postgres、Skill 市场、WebHook / ChatOps 出口、远程执行 Agent（在目标环境代执行）。

详见 [07 路线图](./07-roadmap.md)。

## 7. 对 Draft 的增补与修正

Draft 列出的命令"不够专业/不够原子级"。在 [02 命令参考](./02-command-reference.md) 做了以下修订，原则是 **一动词 = 一效果**：

- **`/infra` 补**：`net`（VPC/subnet/sg）、`iam`（role/policy）、`cert`（ACM/Certificate Manager）、`secret`（Secrets Manager/Secret Manager，只读引用，不存明文）、`registry`（ECR/Artifact Registry）。
- **`/cluster` 补**：`apply`/`rollout`/`restart`/`port-forward`/`exec`（HITL），`events`（按资源聚合），`ns`（命名空间管理）。拆 `describe` / `get` 语义（`get` 只拿字段，`describe` 拿人类可读聚合）。
- **`/app` 补**：`release list/diff/promote`（区分 `ship` 与 `promote`），`feature-flag`（Key-Value，需审批），`secret bind` / `secret unbind`（引用外部 Secret Provider）。
- **`/ops` 补**：`runbook run`（执行具名 runbook），`incident open/close/link`，`slo status <service>`。`report` 拆成 `report generate daily|weekly` 与 `report view`。
- **跨域动词统一**：`diagnose / predict / optimize` 统一返回 Markdown 报告 + 结构化 findings；**结论只读**，不含副作用。

## 8. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Skill 执行任意代码 → 事故/安全事件 | 沙箱执行；Skill 声明所需 capability（云、K8s、网络），越权拒绝；变更命令强制 HITL；见 [05](./05-security-audit.md) |
| 多云抽象泄漏 → 命令不一致 | Provider Capability Matrix（见 [03 §4](./03-architecture.md)），不支持时显式 `UnsupportedOperation`，不伪装成功 |
| 输入形式语法扩张 → 解析器漏洞 | 解析器严格 LL 语法 + golden test；拒绝模糊；见 [02 §5](./02-command-reference.md) |
| UI 做成 AI Chat → 破坏确定性 | UI 明确划分 **Command Bar（命令）/ Explain Pane（解释）**；AI 只出现在 Explain Pane，见 [06 §3](./06-ui-ux-design.md) |
| Demo 跑通 ≠ 生产可用 | 路线图明确 v0 / v1 边界，不合并范围；见 [07](./07-roadmap.md) |
