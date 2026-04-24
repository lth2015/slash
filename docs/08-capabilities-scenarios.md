# 08 · v0.7 规划：从原子到能力到场景（doc-first）

> **输入**：[todo-v2.md](../todo-v2.md) 给出的下一阶段目标——基于 53 条原子命令构建"能力 / 场景"，验证原子层是否足够，并在真实使用中发现新的原子需求。
>
> **状态**：✅ APPROVED 2026-04-24。§8 全部决策点按本文提议执行（YAML manifest / 窄 DSL / Markdown 场景 / 只 GitLab / M1→M2→M3）。规范文档在 [docs/09](./09-capabilities.md) 和 [docs/10](./10-scenarios.md)。

## 0. TL;DR

- **四层抽象**：业务流程 → 场景 → 能力 → 原子命令。目前只有最底层一层。
- **本文提议**的最小可工作切片：
  - 新增**能力（Capability）**层 —— YAML 声明的"多原子命令组合"，读 + 写都能聚合，带 HITL 批准。
  - 新增**场景（Scenario）**层 —— 薄薄一层："挑几个能力、按顺序执行、给出人可读的结论"。
  - 首批 3 个能力、2 个场景、≈4 个新原子命令（从场景反推出来的 gap）。
- 严格继承 harness 安全原则：**能力不是新原语，只是 read + 批量 pre-approve 的 write 编排**。每个写仍然过原子层的 preflight / dryrun / HITL。
- **不做**：Agent、LLM 决策、定时器、并行调度。这些是下下阶段。

---

## 1. 背景与约束

### 1.1 四层抽象

| 层 | 例子 | 现状 | 本文涉及 |
|---|---|---|---|
| 业务流程 | "周一例行巡检 + 自动化清理 + 周报 + on-call 移交" | ❌ | 不做 |
| 场景 | "QA 集群巡检"、"触发流水线并跟踪到 QA 部署" | ❌ | **新增** |
| 能力 | "查找集群异常"、"汇总流水线状态"、"资源孤儿盘点" | ❌ | **新增** |
| 原子命令 | `/cluster pods`、`/app deploy`、`/infra aws vm dashboard` | ✅ 53 条 | 查漏补缺 |

### 1.2 已有约束（继承自 Harness）

- **单机 PoC**，不做服务化（见 docs/03 §0）。
- **每个写操作**必须过 4 层护栏：preflight / plan / HITL approve / dryrun / apply（见 docs/05 §1.1）。
- **LLM 只读**：`/help` 和 `/explain` 是仅有的 LLM 出口，都不能执行命令（见 docs/05 §3）。
- **argv-only 运行时**：不走 shell，不让字符串插值到命令行（见 docs/04 §7）。
- **审计**：所有 Turn 落到 `.slash/audit/audit.jsonl`，sha256 stdout 指纹。

### 1.3 todo-v2.md 的红线

> **"AI 不能闯祸。"**  所有的前提都是不让 AI 导致生产事故。

这决定了"能力"不能是 AI 自由发挥的黑盒。它必须是**人写好的、可静态审查的、显式声明所有可能副作用的**脚本。

---

## 2. "能力"层的工程设计

### 2.1 定义

> **能力 = 一串按顺序执行的原子命令调用，带共享上下文、聚合输出、统一 HITL 闸门。**

三个关键特征：
1. **组合，不是新原语**：能力只能调用已存在的原子 skill，不能做新 bash。
2. **输出是结论，不是日志堆**：能力必须给出"人可读的 findings + 建议下一步"，而不是把 5 个原子的 JSON 合起来 dump。
3. **一次 HITL 覆盖多个写**：如果能力包含 N 个写操作，用户在能力级审批卡上一次性 approve/reject；展开看到每个原子的 plan。

### 2.2 提议 Manifest

```yaml
# capabilities/cluster/inspect/capability.yaml
apiVersion: slash/v1
kind: Capability
metadata:
  id: cluster.inspect
  name: "集群巡检"
  description: "跑一组只读 skill，汇总异常 findings。"

spec:
  command: { namespace: cluster, verb: inspect }
  profile: { kind: k8s, required: true }
  mode: read  # 能力整体的 mode：read 不需审批；write/mixed 需要
  args:
    - { name: ns, flag: --ns, type: string }

  steps:
    # 每个 step 是对一个原子的调用，显式列出绑定。
    # 参数可以 literal 也可以从能力的 args 里拿。
    - id: list_pods
      skill: cluster.pods
      args: { ns: "${args.ns}" }
    - id: recent_events
      skill: cluster.events
      args: { ns: "${args.ns}" }
    - id: node_health
      skill: cluster.nodes
    - id: top_pods
      skill: cluster.top
      args: { ns: "${args.ns}" }

  findings:
    # 声明式 finding 规则：从 step 输出里提取关键指标。
    # 运行时在聚合阶段跑这些规则；出来的结论渲染为 FindingsCard。
    - id: pending_pods
      from: list_pods
      when: "any(row.status.phase == 'Pending')"
      severity: warn
      message: "${count} pods in Pending"
      suggest: "/cluster describe <pod> --ns ${args.ns}"

    - id: crashloop_pods
      from: list_pods
      when: "any(row.status.containerStatuses[0].state.waiting.reason == 'CrashLoopBackOff')"
      severity: error
      message: "${count} pods in CrashLoopBackOff"
      suggest: "/cluster pod events <pod> --ns ${args.ns}"

    - id: warning_events
      from: recent_events
      when: "any(row.type == 'Warning')"
      severity: warn
      message: "${count} warning events in last hour"
```

**不做**的东西（故意不做）：
- 循环 / 条件 / 变量赋值：不是图灵完备。
- 并行步骤：默认顺序。后面如果需要再加 `parallel: true`。
- 能力调用能力：一层就够。

### 2.3 运行时

新增 `apps/api/slash_api/capability/` 模块，对等于 `skills/` 的加载 / 执行路径：

1. **加载**：`load_capabilities(capabilities_dir)` 返回 `CapabilityRegistry`，启动时失败即 crash（和 skills 一致）。
2. **解析**：Command Bar 里 `/cluster inspect --ns api`  → 如果没有 skill 匹配，fallback 到 capability registry。Skill 优先级 > Capability，避免 shadowing。
3. **执行**：
   - 纯 read 能力：直接按 steps 顺序调用现有 `execute()` runner，收集每个 step 的结果；然后跑 findings 引擎。
   - 含 write 能力：先跑所有 read step 建立"初始状态"，再把所有 write step 的 plan 摆在一张"能力级 PlanCard"上，HITL 批准后再顺序执行（每个 write 仍经过各自的 preflight/dryrun/apply）。
4. **审计**：能力作为一个 Turn 记一条 `capability_id`，下面每个 step 记 `skill_id` + `parent_run_id` 关联。

### 2.4 HITL 策略（安全核心）

| 能力成员 | 审批模型 |
|---|---|
| 全是 read | 无需审批（和 read skill 一样） |
| 包含 write（非 danger） | 能力级 PlanCard：列出每个 write step 的 plan，单次 Approve 批准全部；运行时仍按 step 跑 preflight/dryrun；任一失败 → 回退到"已完成 step" + Stop + 不触发剩余 write |
| 包含 danger write | 能力级 PlanCard 顶部红条，需输入 `YES`；每个 danger step 额外在 step 卡上做第二次确认（保留原有硬门） |

**关键原则**：能力级审批**不能降低**原子级的保护。它只能**聚合**。

### 2.5 UI 呈现

- 新视图 `capability-result`：
  - 顶部：能力名 + findings（严重度色带：error/warn/info）+ 聚合的"建议下一步" chip 列表（都是原子命令，点击填 CommandBar）
  - 中部：每个 step 的 collapsed 标题 + ok/error 状态；点开展开原 skill 的 ResultCard（复用）
  - 底部：耗时、step 数、下一步建议
- 写能力的 PlanCard 新布局：每个 write step 折叠一行，可展开看 before/after diff。

---

## 3. "场景"层的工程设计

### 3.1 定义

> **场景 = 推荐的能力使用序列 + 人话讲解 + 预期输出模板。**

场景比能力更薄：它不是新的执行原语，而是**文档 + 入口点 + 结果解释模板**。

### 3.2 提议形态

场景作为**Markdown 脚本**存在 `scenarios/`：

```markdown
# scenarios/qa-daily-check.md
---
id: qa-daily-check
title: QA 集群日常巡检
estimated_minutes: 3
requires_pins: [k8s, aws]
---

## 目标
每天早上 10 分钟了解 QA 集群整体健康度，锁定异常 pod / 流失资源。

## 步骤

1. **巡检 EKS QA 集群**
   ```
   /cluster inspect --ns api
   /cluster inspect --ns data
   ```
   关注：CrashLoopBackOff、Pending、Warning events。

2. **巡检 GCP QA 集群**（切 ctx 后重复）
   ```
   /ctx pin k8s gke-qa --tier safe
   /cluster inspect --ns api
   ```

3. **查孤儿存储**
   ```
   /infra aws ebs orphans --region us-east-1
   ```
   （**NEW 原子命令**——§5 会补）

4. **根据 findings 决定清理**：如发现 orphan EBS，不直接删，进入场景 `qa-cleanup`。

## 结论模板
- ✅ 正常：pending/crash 为 0、warning events < 5、orphan 资源 0
- ⚠ 警告：crash ≥ 1 或 warning ≥ 10 —— 触发 `qa-cleanup`
- ❌ 异常：nodes NotReady ≥ 1 —— 升级到 oncall
```

**为什么是 Markdown 而不是 YAML**：
- 场景主要是**说明 + 入口引导**，不是声明式数据。
- 用户 copy-paste 每一个命令到 CommandBar 手动执行 —— 人仍在回路里。
- 未来如果做 Agent orchestration，YAML 形态再加。

### 3.3 UI 呈现

- 顶部 banner "Recent" 旁边加一个"Scenarios"按钮：点开侧栏列出所有 scenarios，每个一张卡（标题、预计时长、所需 pin）。
- 点一个场景 → 弹出全屏 drawer 展示 Markdown 内容 + 每个命令 chip"Copy to bar"按钮。
- 场景运行时不自动化——用户手动复制 → CommandBar → Enter，每一步看到结果再决定下一步。

---

## 4. 首批交付内容（v0.7）

### 4.1 能力（3 条）

| ID | mode | 组合 | 输出 |
|---|---|---|---|
| `cluster.inspect` | read | pods + events + nodes + top | findings：pending / crashloop / warning / notready |
| `pipeline.recent_failures` | read | gitlab.pipelines.list（**NEW**）+ gitlab.pipeline.get（**NEW**） | findings：最近 N 次失败的 project + job + 错误摘要 |
| `infra.aws.orphan_scan` | read | ebs.list（**NEW**）+ elb.list + snapshot.list（**NEW**） | findings：未挂载卷 / 无后端 ELB / 快照冗余 |

### 4.2 场景（2 个 Markdown 剧本）

| ID | 使用能力 | 适用 |
|---|---|---|
| `qa-daily-check` | cluster.inspect × 2 + infra.aws.orphan_scan | 每日巡检 |
| `pipeline-triage` | pipeline.recent_failures → 进 GitLab 看 job log | 修流水线 |

### 4.3 新增原子命令（从场景反推，4 条）

todo-v2.md 提到 GitLab 流水线、资源清理。当前原子层没覆盖。提议：

| 命令 | 读/写 | bash | 难点 |
|---|---|---|---|
| `/gitlab pipelines list [--project <p>] [--status failed] [--since <d>]` | R | `curl GitLab API` | 需要 `GITLAB_TOKEN`；新增 `gitlab` profile kind |
| `/gitlab pipeline get <id> --project <p>` | R | 同上 | 返回 jobs + log excerpts |
| `/infra aws ebs orphans [--region <r>]` | R | `aws ec2 describe-volumes --filters Name=status,Values=available` | 无——复用 aws profile |
| `/infra aws snapshot list [--region <r>] [--owner self]` | R | `aws ec2 describe-snapshots` | 同上 |

**不包含** cleanup 写操作。第一版只做**发现**，清理等下一轮再加（且每个都必须 `danger: true`）。

### 4.4 不包含

- 流水线的**触发** / **重跑**（写操作，先看清 list/get 数据能不能用再上）
- 自动化 cron / 定时巡检
- LLM 汇总 findings（现在是规则引擎；LLM 在 `/explain` 已经可以解读单个能力输出了）
- Agent 链式调用

---

## 5. 实施顺序（M1 / M2 / M3）

### M1 · 原子层补漏（~3 天）

先把 4 条新原子 skill 落下，因为它们是其他两层的原料。

- 新 profile kind：`gitlab`（只存 token，在 `~/.config/slash/gitlab.toml` 或环境变量；敏感度对齐 `~/.aws/credentials` 模式）
- YAML + tests/fixtures 照抄现有模式
- 视觉：GitLab pipelines 用 `table` + state-badge，snapshot list 用 table + size 列

**产出**：4 条新原子命令；53 → 57 skills。

### M2 · 能力层运行时 + 3 条能力（~5 天）

- `apps/api/slash_api/capability/` 新模块
- Loader / parser fallback / executor / findings 引擎 / audit 扩展
- 新视图 `capability-result`
- 3 条首批能力 YAML + tests/fixtures
- docs/04-skills.md 附录一段解释 Capability 和 Skill 的关系
- 新增 docs/09-capabilities.md（规范文档）

**产出**：`/cluster inspect`、`/pipeline recent-failures`、`/infra aws orphan-scan` 可跑。

### M3 · 场景层剧本 + UI drawer（~2 天）

- `scenarios/` 目录 + 2 个 md 剧本
- UI：Scenarios 按钮 + drawer + "Copy to bar" 按钮
- docs/10-scenarios.md（规范文档）

**产出**：QA 日常巡检和 pipeline triage 两个场景可走通。

---

## 6. 工程约束（写在前面避免跑偏）

| 约束 | 理由 |
|---|---|
| **能力不能调用 bash** | 否则就绕开了原子层的 4 层护栏（preflight / plan / HITL / dryrun）。所有 I/O 都必须通过 skill。 |
| **能力不能动态决定下一步** | 静态 steps only。条件分支、循环、变量赋值都不做。要分支就是两条能力。 |
| **能力的 write 审批不降级** | 原子级 danger 不因为在能力里就不需要二次确认 `YES`。 |
| **findings 规则必须声明式** | 不让 JS/Python eval 任意表达式。支持一个受限的 DSL（`any(row.x == 'y')`、`count > N`）就够。 |
| **场景是引导，不是执行** | 场景文档不能触发自动化。必须用户 copy-paste 命令到 CommandBar。保留"人在回路"。 |
| **新原子优先 read** | 先让 AI 只能"看"，等用户对 findings 满意再加 write。 |

---

## 7. 风险和缓解

| 风险 | 缓解 |
|---|---|
| 能力 YAML 变成小编程语言，难审查 | 严格约束：无循环、无条件、无 eval；DSL 白名单。 |
| findings 规则误报 / 漏报 | 每条 findings 自带 `severity` 和 `suggest`；用户可按 severity 过滤；规则可测——tests/ 目录每条能力带 fixture。 |
| 能力级 HITL 让人麻木地一把 approve | 能力的 PlanCard 必须**默认展开全部 write step 的 diff**，不能折叠。Danger step 额外输 `YES`。 |
| 场景 md 过时 | 每个场景顶 frontmatter 写 `verified_against: v0.7`；发版时自动校验引用的 skill/capability id 存在。 |
| GitLab token 泄露 | 和 AWS/GCP 走同一套 profile 机制；token 不入 log/audit；`redact()` 扩展识别 `glpat-*` 前缀。 |

---

## 8. 决策点（需要 user 拍板再动）

1. **能力承载形式**：YAML manifest（本文方案）vs Python 模块 vs Markdown + 临时 API？
2. **findings DSL**：支持多少？（建议：`any` / `count` / `row.path == literal` / 简单比较。不支持赋值 / 函数。）
3. **场景是 md 还是 YAML**：md（本文提议）保"人在回路"；YAML 则可走向自动化。
4. **GitLab vs 其他 pipeline**：固定 GitLab，还是做 `pipeline` 抽象（GitLab + GitHub + Jenkins）？建议 v0.7 先只做 GitLab。
5. **M1/M2/M3 的顺序和粒度**：上面提议 10 天量，是否太大/太小？

---

## 9. 与既有规约的关系

| 已有文档 | 本文的影响 |
|---|---|
| 01-spec.md | 不改；"原子 skill"仍是核心原语。 |
| 02-commands.md | 新增 `/cluster inspect`、`/pipeline recent-failures`、`/infra aws orphan-scan` 等（都是能力命令，但语法对用户无差别）。 |
| 03-architecture.md | 架构图里多一个"Capability Registry"盒子和"Findings Engine"旁路；端点数保持 §2.2 不变。 |
| 04-skills.md | 附一段讲 Capability 和 Skill 的边界。详细规范挪到 09-capabilities.md。 |
| 05-safety-audit.md | §2 HITL 扩展到"能力级审批"；§3 LLM 无影响（能力不走 LLM）；§4 audit schema 加 `capability_id` + `parent_run_id` 字段。 |

---

## 10. 下一步（如果 user 同意本规划）

1. 用户 review 本文，在 §8 决策点给出答复。
2. 根据决策修订本文到 v1（定稿）。
3. 生成 docs/09-capabilities.md（规范）和 docs/10-scenarios.md（规范）。
4. 才开始 M1 编码。

**如果 user 对某些方向有异议**，最可能要改的是 §4.3（新原子选哪些）和 §2.4（HITL 聚合策略）。这两处影响最大，代码动之前务必对齐。
