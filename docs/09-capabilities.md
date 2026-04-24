# 09 · 能力（Capability）规范

> 能力 = 一组原子 skill 的**静态顺序组合** + 声明式 findings。
> 它不是新原语——不能调用 bash，不能做 skill 以外的事。所有写操作仍然走原子层的 4 层护栏（preflight / plan / HITL / dryrun）。
>
> 本文是 M2 实施的契约。与 [docs/04 Skills](./04-skills.md) 并列一层。

## 1. 边界（写在最前面，最重要的部分）

能力能做什么：
- ✅ 按顺序调用一个或多个已注册的原子 skill
- ✅ 在 step 之间传递上下文（args、前序 step 的 output）
- ✅ 对聚合后的 output 跑声明式 findings 规则，得出人可读的结论
- ✅ 把多个写 step 的 plan 聚合成一张审批卡

能力**不能**做什么（硬约束，loader 必须拒绝）：
- ❌ 调用 bash / 执行外部命令 / 任意 I/O
- ❌ 在 step 之间插入条件 / 循环 / eval 表达式
- ❌ 降低原子 skill 的安全级别（danger skill 在能力里仍需二次确认 `YES`）
- ❌ 调用其他能力（一层扁平结构，不递归）
- ❌ 在 findings 规则里执行任意代码（白名单 DSL only）

一句话：**能力是"带 findings 的批处理 runbook"，不是"轻量 agent"。**

## 2. Manifest 结构

目录：`capabilities/<namespace>/<verb>/capability.yaml`（与 `skills/` 并列）。
所有字段均为静态可审查；loader 在启动时完整验证，任一错误即 startup fail。

```yaml
apiVersion: slash/v1
kind: Capability          # 与 Skill 区分的 discriminator
metadata:
  id: cluster.inspect           # 命名规则同 skill：<namespace>.<verb>
  name: "集群巡检"
  description: "跑一组只读 skill，汇总异常 findings。"     # ≤ 200 字符
  version: 0.1.0
  labels: { stability: alpha, risk: low }

spec:
  # Parser shape — 同 Skill。命名空间与原子 skill 冲突时 skill 优先，loader
  # 启动时校验无 (namespace, command_path) 碰撞。
  command: { namespace: cluster, verb: inspect }
  profile: { kind: k8s, required: true }

  # mode: "read" | "write" | "mixed"
  #   read   : 所有 step 都是 read skill
  #   write  : 至少一个 step 是 write skill（加 write 的都必须；mixed 用这个）
  #   mixed  : 别名 = write（预留未来区分）
  # loader 验证：声明的 mode 必须与 steps 引用的 skill 的 mode 一致或更严。
  mode: read

  # 能力接受的命令行参数。单纯把原子 skill 的 args 往上抬了一层；
  # step 内可以用 ${args.ns} 引用。格式与 skill.args 完全一致。
  args:
    - { name: ns, flag: --ns, type: string }

  # 顺序执行的 step 列表。
  steps:
    - id: list_pods                 # step id，必须在本能力内唯一；用于后续引用
      skill: cluster.pods           # 必须是已注册的原子 skill id
      args:                         # 显式把能力 args/literal 注入到 skill args
        ns: "${args.ns}"
      # expect: 可选的 step-level 成败条件。默认 exit_code == 0。
      # expect: { success_exit_codes: [0], success_states: ["ok"] }

    - id: recent_events
      skill: cluster.events
      args: { ns: "${args.ns}" }

    - id: node_health
      skill: cluster.nodes
      # 无 args：skill 本身也无必填 args

  # 声明式 findings：运行时在所有 step 成功后，按顺序跑每条规则；
  # 每条规则匹配后产出一条 finding（severity / message / suggest）。
  findings:
    - id: pending_pods
      from: list_pods                             # 引用 step id
      when: "any(row.status.phase == 'Pending')"  # 受限 DSL，见 §4
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
      when: "count(row.type == 'Warning') > 0"
      severity: warn
      message: "${count} warning events"

  # 能力级 rollback 提示；在 write 能力的 Result 卡上显示。
  # 对 read 能力无效。
  rollback: "各 write step 请参考各自 skill 的 rollback 建议。"
```

## 3. 加载与命名空间

- 新模块：`apps/api/slash_api/capability/` — loader / executor / findings engine。
- 启动时加载顺序：**skills 先**，**capabilities 后**。
- 冲突策略：命名冲突（`namespace + command_path` 完全一致）→ **startup fail loud**。能力不能 shadow skill；反之亦然。
- 命名空间共享：能力可以用任一现有 namespace（cluster / infra / app / ops / ctx）。解析时 parser 先看 skill registry，再看 capability registry。

## 4. Findings DSL

窄得不能再窄，故意不是图灵完备。完整语法：

```
expr   := call | comparison | expr && expr | expr || expr | !expr | '(' expr ')'
call   := ('any' | 'count' | 'first') '(' expr ')'
comparison := path op literal | literal op path
path   := 'row' ('.' ident | '[' number ']')*
ident  := [a-zA-Z_][a-zA-Z0-9_]*
op     := '==' | '!=' | '<' | '<=' | '>' | '>='
literal:= "string" | 'string' | number | 'null' | 'true' | 'false'
```

**语义**：
- `row` 绑定到 step 输出的一行（array 的 item）。
- `any(...)`: 任一 row 满足 → true
- `count(...)`: 满足的 row 数，数字返回（用于 `count(...) > N`）
- `first(...)`: 第一条满足的 row（返回 object；暂未在 v0.7 用到，预留）
- 只支持受限的点/下标路径访问，不支持函数调用、算术、赋值。
- 解析器手写（Python `re` + 递归下降），不用 eval/exec。AST 校验在 loader 启动阶段完成。

**禁止**（loader 会拒绝）：
- 算术 (`+ - * /`)
- 赋值、变量绑定
- `eval`、`exec`、任何语义上的函数调用（除 `any/count/first`）
- 正则、字符串操作函数
- 循环、条件（三元表达式）
- 跨 step 引用（findings 规则只能看 `from` 指向的那个 step 输出）

### 消息插值

`message` / `suggest` 字段支持 `${...}` 插值：
- `${count}` — 匹配该规则的 row 数（仅当 `when` 使用 `any/count/first` 时）
- `${args.name}` — 能力的 flag/positional 值
- `${first.path}` — `from` step 的第一条匹配 row 的字段（供人读场景，例如 `pod=${first.metadata.name}`）

不支持任意表达式。

## 5. 运行时

### 5.1 执行模型

```
for step in spec.steps:
    argv   = build_argv(skill_manifest, merge(step.args, ctx))
    result = runtime.execute(argv, env, timeout)
    if not step.expected(result):
        abort + record partial output + skip remaining steps
        return capability_result(state="error", step=step.id, ...)

findings = run_findings_engine(spec.findings, step_outputs)
return capability_result(state="ok", outputs=step_outputs, findings=findings)
```

每个 step 仍然走 `runtime.execute()` —— 复用 skill 层全部的 argv-only / shell=False / timeout / audit 机制。能力运行时**不发明第二个 subprocess 入口**。

### 5.2 HITL（write / mixed 能力）

能力级审批卡（`CapabilityPlanCard`）：
- 顶栏：能力 id、mode、risk（聚合自各 write step）
- 中部：按 step 顺序展开每个 **write** step 的 before/after diff。**默认展开不折叠**。
- 若包含 `danger: true` 的 skill step：
  - 能力级顶部加红条 + 输入 `YES` 解锁 Approve
  - danger step 在展开里额外渲染一次「每一步 danger 确认需打环境名」（继承 skill 的硬门，不降级）
- Approve 一次 → 所有 write step 依序跑；每个 step 仍然**独立**跑 preflight + dryrun 再 apply
- 任一 step 失败 → Stop，不触发后续 step，结果卡标记 `partial`

Read step 在审批前就已完成（为了 plan 能算出"现状"）。这点和单个 skill 的 plan 生成期行为一致。

### 5.3 Audit

每次能力执行写一条 audit 记录（`skill_id=capability_id`, `kind=capability`）+ 每个子 step 写自己的记录，通过 `parent_run_id` 关联：

```json
{"kind":"capability", "run_id":"r_cap_...", "skill_id":"cluster.inspect", "steps":["list_pods","recent_events","node_health"], "state":"ok", "findings":[...]}
{"kind":"step", "run_id":"r_...", "parent_run_id":"r_cap_...", "skill_id":"cluster.pods", "state":"ok", "stdout_sha256":"..."}
```

查询 `/ops audit logs --run r_cap_xxx` 可以把整条链拉出来。

## 6. UI

### 6.1 新视图 `capability-result`

出现在 ResultCard dispatch 里，触发条件：`output_spec.kind == "capability"` 或能力命令的 response 自带 flag。

布局：

```
┌ CAPABILITY · cluster.inspect ──────────────────── 2.4s ┐
│  ⚠  3 findings                                         │
│  ■ error  2 pods in CrashLoopBackOff                   │
│         → /cluster pod events <pod> --ns api           │
│  ■ warn   5 pods in Pending                            │
│         → /cluster describe <pod> --ns api             │
│  ■ warn   12 warning events                            │
├────────────────────────────────────────────────────────┤
│  ▼ step 1/3 · list_pods     · read · 140 rows   1.2s  │ ← 展开显示子 ResultCard
│  ▶ step 2/3 · recent_events · read · 63 rows    0.9s  │
│  ▶ step 3/3 · node_health   · read · 8 rows     0.3s  │
└────────────────────────────────────────────────────────┘
```

- findings 按 severity 排序：error → warn → info，error 红、warn 橙、info 灰
- suggested command 是灰色只读 chip，点击填 CommandBar（永不自执行）
- 展开 step 复用现有 ResultCard（不重造轮子）

### 6.2 CapabilityPlanCard（write/mixed）

和 `ApprovalCard` 结构一致，但：
- `steps` 区多一列"类型"（read-snapshot vs write-plan）
- `before/after` 来自对应 write step 的 plan.argv 输出
- Reject 拒绝整个能力，和单 skill 审批一样必填原因

## 7. 与已有文档的关系

- [02-commands.md](./02-commands.md) §3：新增一条 "能力命令" 形态——parser 对用户无差别感知，能力被当作 skill 来路由。
- [04-skills.md](./04-skills.md)：原子 skill 的定义不变；加一段"Capability 是 Skill 的使用者，不是竞争对手"。
- [05-safety-audit.md](./05-safety-audit.md) §2：HITL 表加一行"能力级审批"；§4 audit schema 说明 `kind=capability` + `parent_run_id`。
- [03-architecture.md](./03-architecture.md)：架构图加 `CapabilityRegistry` + `FindingsEngine` 两个盒子。

## 8. 测试策略

每条能力带 `tests/cases.yaml`：
```yaml
cases:
  - name: "healthy cluster"
    input: "/cluster inspect --ns api"
    # mock 每个 step 的 stdout fixture
    steps:
      list_pods:     { stdout: "fixtures/pods_happy.json", exit: 0 }
      recent_events: { stdout: "fixtures/events_empty.json", exit: 0 }
      node_health:   { stdout: "fixtures/nodes_ok.json", exit: 0 }
    expect:
      state: ok
      findings_count: 0

  - name: "crashloop detected"
    input: "/cluster inspect --ns api"
    steps:
      list_pods:     { stdout: "fixtures/pods_crashloop.json", exit: 0 }
      recent_events: { stdout: "fixtures/events_empty.json", exit: 0 }
      node_health:   { stdout: "fixtures/nodes_ok.json", exit: 0 }
    expect:
      state: ok
      findings_by_id:
        crashloop_pods: { severity: error, count: 2 }

  - name: "step failure short-circuits"
    input: "/cluster inspect --ns api"
    steps:
      list_pods: { stdout: "", stderr: "connection refused", exit: 1 }
    expect:
      state: error
      failed_step: list_pods
      # recent_events / node_health must NOT have been called
      steps_executed: 1
```

Harness 扩展：`mock` 字段改为按 step 映射。所有 test 在 pytest 套件里独立跑。

## 9. 非目标（明确写出来避免 scope creep）

- 并行 step：v0.7 只有顺序。
- 能力调用能力：不做。
- LLM 生成 findings 或改写结论：不做。findings 引擎是规则。
- 能力的版本化 / a-b 切换：不做。一个 id 一个文件。
- 跨能力 ctx 传递：不做。每个能力命令是一次独立的 Turn。
- UI 侧的 capability builder：不做。能力只能手写 YAML。

## 10. 首批交付（v0.7）

| ID | mode | 组合 | 首次交付 M2 |
|---|---|---|---|
| `cluster.inspect` | read | pods + events + nodes + top | ✅ |
| `pipeline.recent_failures` | read | gitlab.pipelines.list + gitlab.pipeline.get | ✅ |
| `infra.aws.orphan_scan` | read | ebs.orphans + elb.list + snapshot.list | ✅ |

全部 read，零 write。v0.7 目的是让能力机制和 findings 引擎跑起来；写能力等 read 确认有价值再加。
