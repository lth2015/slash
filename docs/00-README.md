# Slash 文档索引

> Slash 是面向 SRE 的**统一命令面板**（Command Palette for SRE）。以命令式、原子化的接口封装多云与 Kubernetes 操作，配合 Git 化、可审计、可回滚的 **Skill 生命周期**，同时提供顶级商业产品级别的 UI/UX。

本目录是文档先行（doc-first）的产物。**在任何代码动工之前**，请先通读全部文档、完成自省与评审。

## 阅读顺序

| 序号 | 文档 | 读者 | 作用 |
| --- | --- | --- | --- |
| 01 | [产品规格（PRD）](./01-product-spec.md) | PM / SRE Lead | 为什么做、做给谁、做到什么程度 |
| 02 | [命令参考（Command Reference）](./02-command-reference.md) | 所有人 | Slash 语言规范（EBNF、原子命令、参数、退出码） |
| 03 | [架构（Architecture）](./03-architecture.md) | 架构 / 工程 | 模块、数据流、依赖、技术选型 |
| 04 | [Skills 体系（Skills System）](./04-skills-system.md) | Skill 作者 / 审阅者 | Skill 文件格式、生命周期、GitOps、沙箱 |
| 05 | [安全与审计（Security & Audit）](./05-security-audit.md) | SecOps / 合规 | 输入净化、HITL、审计链路、威胁模型 |
| 06 | [UI/UX 设计（UI/UX Design）](./06-ui-ux-design.md) | 设计 / 前端 | 信息架构、视觉系统、关键页面规格 |
| 07 | [路线图（Roadmap）](./07-roadmap.md) | 全员 | Demo → v1 分阶段交付计划 |

## 核心决策（本文档集已冻结的前置约定）

以下决策已经在对应文档中落地，作为后续编码的**唯一事实源**：

1. **输入模型**：严格命令语法，**不接受自然语言**。输入通过形式语法解析；解析失败即拒绝。见 [02 §2](./02-command-reference.md)。
2. **执行模型**：所有副作用走"计划 → 审批 → 执行 → 记录"四段式，HITL 不可跳过（除 `--dry-run` 与显式白名单的只读命令）。见 [05 §4](./05-security-audit.md)。
3. **扩展单位**：Skill。目录结构即命令树，一条原子命令对应一个 Skill。Skill 仓库用 Git 管理，变更走 PR。见 [04](./04-skills-system.md)。
4. **多云抽象**：`/infra` 屏蔽 AWS / GCP 差异。Provider 为可插拔适配器，Skill 通过 Provider SDK 访问资源，不直接调云 API。见 [03 §4](./03-architecture.md)。
5. **技术栈**：前端 Next.js 15（App Router）+ TypeScript + Tailwind + shadcn/ui + CodeMirror 6；后端 FastAPI（Python）；SQLite（demo）。见 [03 §3](./03-architecture.md)。
6. **不做**（Demo 阶段）：SSO、多租户、多区域部署、Secret 托管。Demo 使用本地单用户，身份来自 OS。见 [01 §6](./01-product-spec.md)。

## 术语表

| 术语 | 含义 |
| --- | --- |
| Slash | 本工具 |
| Skill | 一条原子命令的可执行定义（manifest + 代码） |
| Provider | 云厂商 / K8s / 监控系统的适配器 |
| HITL | Human-in-the-Loop，必要变更须人工审批 |
| Plan | 命令的执行预览（不产生副作用） |
| Effect | 命令执行后对外部系统的副作用 |
| Audit Record | 追加写的操作留痕 |
