# 01 · 产品规格

## 1. 一句话

SRE 在本机跑一个单窗口驾驶舱，用严格命令语言操作 AWS / GCP / Kubernetes；写操作人类审批；LLM 只帮"读懂结果"。

## 2. 用户

一个 SRE。在本机。已经 `aws configure`、`gcloud auth login`、`kubectl config use-context` 过。

**不是**：多人协作平台。没有 SSO、没有工作区、没有团队。

## 3. 形态

**一个浏览器页面，一个"驾驶员操控板"**。

- 顶部：微型 Context Bar（当前 AWS profile、GCP project、K8s context）。只读显示，右侧一个 "change" 链接切到下拉。
- 中部：**对话流**，每个 Turn 是一张卡（紧凑、单列、时间线）。
- 底部：**Command Bar**（固定、永在、键盘优先）。

不做：Sidebar 导航菜单，不做 Runs / Approvals / Skills / Audit 独立页面 —— 所有这些都存在于"对话流里的卡"，或者根本不需要存在。

## 4. 在这里可以做什么（Demo 阶段）

用户在 Command Bar 输入 `/infra aws vm list --region us-east-1`，按 Enter：
- 解析（严格，不通过就地画红波浪线）
- 执行（read → 直接跑 bash；write → 插入审批卡，点 Approve 才跑）
- 结果渲染为一张 Result 卡（表格 / JSON / 日志流）
- LLM 摘要（可选、带标签、可关闭）

覆盖：`/infra aws|gcp`、`/cluster <ctx>`、简单 `/ops audit logs`（读 jsonl 文件）。共约 10 条原子 skill，对齐 [02](./02-commands.md)。

## 5. 明确不做

- **不做** 自然语言执行入口。LLM 不解释命令去执行。
- **不做** 多用户、SSO、RBAC、多租户。
- **不做** Skill 市场 / Skill Browser / Skill 版本化存储。Skills 是本地文件、改了就生效。
- **不做** 审批队列页、审计查询页。审批在对话流卡里批；审计在 `audit.jsonl` 里，要查就用 `/ops audit logs`。
- **不做** 持久化数据库。jsonl + in-memory 足够。
- **不做** 业务花哨：没有图表仪表盘、没有 SLO 面板、没有告警集成（除非以 `/ops alert` 命令形式访问已有监控系统）。
- **不做** 容器化部署。本机 `make dev` 跑起来就行。

## 6. 验收（Demo 能被接受的条件）

- [ ] 单窗口，无侧栏，Command Bar 永在底部。
- [ ] 至少 3 条 read skill 跑通（`infra.aws.vm.list`、`cluster.get.pod`、`ops.audit.logs`），真实 bash 出真实数据。
- [ ] 至少 1 条 write skill 跑通审批闭环（如 `cluster.scale`），点 Approve 才执行。
- [ ] LLM 摘要可开可关；开启时输出左侧有 `LLM·generated` 标签；关闭时完全不调 LLM。
- [ ] Context Bar 能切换 AWS profile / K8s context 并生效于下一次执行。
- [ ] `audit.jsonl` 每次 Turn 追加一行。
- [ ] 视觉：符合 [06](./06-ui.md) 的"Polite"基调；结果用颜色 / 表格 / 简易图表区分语义。

## 7. 风险与边界

| 风险 | 缓解 |
| --- | --- |
| LLM 伪造"已执行"误导用户 | 执行来自 Skill Runtime，LLM 输出永远带标签、不可成为执行指令；见 [05 §3](./05-safety-audit.md) |
| bash 命令注入（参数里的恶意字符串） | 参数强类型 + 结构化参数绑定（不做字符串拼接）；见 [04 §3](./04-skills.md) |
| 用户误批准毁灭性操作 | `danger: true` 的 skill 二次确认 + Plan 上醒目红条 |
| profile 没配好 | 执行前 preflight 检查凭据，失败就给人看的修复建议 |
