# Slash 文档

> **阶段：single-machine local PoC。** 一人一机一窗口；strict DSL only；LLM 不执行任何命令；写操作本机人审；审计 = 本地 `var/audit.jsonl` 追加。后端 API 只是本地适配层，不做扩张，不做服务化。
>
> **Slash 是一个 SRE 驾驶舱。** 一个窗口、一条命令行、人审批、bash 执行、LLM 辅助解释。不做仪表盘、不做多页面工作区、不做商业化。

## 核心原则（不可违反）

1. **一个窗口**。对话流 + 固定底部 Command Bar。没有侧栏导航菜单。没有 Runs / Approvals / Skills / Audit 独立页面。
2. **输入是严格命令**。形如 `/infra aws vm list --region us-east-1`，EBNF 可解析，禁止自然语言作为执行入口。
3. **执行走 bash**。每个 Skill = YAML manifest + 一段 bash 模板。执行器按 profile 注入环境变量（`AWS_PROFILE`、`gcloud config configurations`、`KUBECONFIG`），凭据假设已在本机配置好。
4. **写操作必须人类审批**。审批卡就地出现在对话流里，不跳页、不弹 Modal。LLM 不能批准任何写操作。
5. **LLM = Gemini 2.5 Flash**，只做三件事：read 结果摘要、错误解释、诊断类 skill 的分析报告。**永远不能执行命令、修改 plan、跳过审批**。输出永远带 `LLM·generated` 标签。
6. **审计 = 一个 jsonl 文件**。追加写，谁 / 时间 / 命令 / 状态 / 结果摘要。不做 Git、不做 hash chain、不做 Postgres。

## 阅读顺序

| # | 文件 | 作用 |
| --- | --- | --- |
| 01 | [spec.md](./01-spec.md) | 范围、用户、不做什么 |
| 02 | [commands.md](./02-commands.md) | 命令语法与原子命令集 |
| 03 | [architecture.md](./03-architecture.md) | 单窗口 UI + bash 运行时 + LLM 辅助的接线 |
| 04 | [skills.md](./04-skills.md) | Skill 文件格式、profile 注入、harness engineering 测试 |
| 05 | [safety-audit.md](./05-safety-audit.md) | HITL、LLM 防欺骗、jsonl 审计 |
| 06 | [ui.md](./06-ui.md) | 驾驶舱 UI 规格（Polite、商业化克制、潮流但不炫） |

## 术语

| 术语 | 含义 |
| --- | --- |
| **Skill** | 一条原子命令的 YAML+bash 定义 |
| **Profile** | 已在本机配置好的 AWS / GCP / K8s 身份（`~/.aws/credentials`, `~/.config/gcloud`, `~/.kube/config`） |
| **Conversation** | 主窗口里的对话流，由若干 Turn 组成 |
| **Turn** | 一次"用户命令 → 计划 → （审批） → 执行 → 结果"的闭环 |
| **HITL** | Human-in-the-Loop，写/改命令必经人审批 |
| **LLM·generated** | 凡是 LLM 生成的内容必须打此标签，不可作为执行触发器 |
