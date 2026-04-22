# 04 · Skills 体系（Skills System）

> Skill 是 Slash 的**原子能力单元**。一条原子命令对应一个 Skill。Skill 必须：安全、可验证、可审计、可回滚。

## 1. 目录即命令树

Skill 的文件路径**直接决定**它的命令坐标。无需在 manifest 里重复写 namespace/noun/verb。

```
skills/
├─ infra/
│  ├─ aws/
│  │  ├─ vm/
│  │  │  ├─ list/
│  │  │  │  ├─ skill.yaml
│  │  │  │  ├─ run.py
│  │  │  │  └─ tests/
│  │  │  │     ├─ test_list.py
│  │  │  │     └─ fixtures/
│  │  │  ├─ get/
│  │  │  ├─ start/
│  │  │  ├─ stop/
│  │  │  └─ restart/
│  │  ├─ oss/
│  │  └─ db/
│  └─ gcp/
├─ cluster/
│  └─ _any/                     # _any = 任意 context
│     ├─ get/
│     ├─ list/
│     └─ scale/
├─ app/
└─ ops/
```

映射规则：
- 路径 `skills/<ns>/<target_slot>/<noun_chain...>/<verb>/` 即命令 `/<ns> <target> <noun_chain...> <verb>`。
- `<target_slot>` 的取值：
  - `/infra` → provider 目录（`aws`, `gcp`, …）
  - `/cluster` → 固定写 `_any`，运行时把 `<cluster_ctx>` 注入 `ctx`
  - `/app` / `/ops` → **没有 target_slot**，目录直接是 noun（对应 [02 §2.2](./02-command-reference.md#22-形态registry-driven-resolution) 的形状模板）
- 复合 noun 用子目录嵌套（如 `vm/snapshot/create`），**命令文本以空格分隔**（`vm snapshot create`），与 [02 §4](./02-command-reference.md) 保持一致。不使用点号、不使用斜杠。
- 子名词 / verb 的匹配由解析器按 Skill 注册表做最长前缀匹配（见 [02 §2.2](./02-command-reference.md#22-形态registry-driven-resolution)）。

## 2. Skill 清单文件（`skill.yaml`）

```yaml
# skills/infra/aws/vm/list/skill.yaml
apiVersion: slash/v1
kind: Skill
metadata:
  id: infra.aws.vm.list
  name: "List AWS VMs"
  description: "List EC2 instances in a region, optionally filtered by tag."
  owners: [sre-platform@example.com]
  version: 1.2.0
  labels:
    stability: stable        # stable|beta|experimental
    risk: low                # low|medium|high
spec:
  command:
    namespace: infra
    target: aws              # /infra 下是 provider；/cluster 写 "_any"；/app /ops 省略
    noun: [vm]               # 复合 noun 用数组，如 [vm, snapshot]
    verb: list
  mode: read                 # read | write
  danger: false
  approvers: 0               # write/high-risk 下 ≥ 1
  timeout: 30s
  args:
    - name: region
      flag: --region
      type: string
      required: false
      default: "us-east-1"
      enum_from: "provider:aws.regions"     # 补全来源
    - name: tag
      flag: --tag
      type: "map<string,string>"
      repeatable: true
      required: false
  capabilities:              # 声明对 Provider 的最小能力需求
    - aws.ec2:DescribeInstances
  output:
    kind: table
    columns:
      - { key: id,        label: "Instance ID", width: 20 }
      - { key: name,      label: "Name",        width: 28 }
      - { key: state,     label: "State",       renderer: badge }
      - { key: type,      label: "Type" }
      - { key: region,    label: "Region" }
      - { key: launched,  label: "Launched",    renderer: relative-time }
    sort_by: launched
    row_key: id
  plan:                      # 对于 write 类，声明 plan 字段集合
    effects: []              # read 类为空
  entrypoint:
    language: python
    file: run.py
    plan_fn: plan            # 可选：write 类必填
    run_fn: run
```

### 2.1 `plan()` / `run()` 约定

```python
# skills/infra/aws/vm/list/run.py
from slash.skill_sdk import Ctx, PlanResult, Row

def plan(ctx: Ctx) -> PlanResult:
    # read 类：直接返回空计划
    return PlanResult(effects=[])

def run(ctx: Ctx):
    ec2 = ctx.providers.aws.ec2(region=ctx.args["region"])
    for inst in ec2.describe_instances(tags=ctx.args.get("tag")):
        yield Row(
            id=inst.id, name=inst.name, state=inst.state,
            type=inst.instance_type, region=inst.region,
            launched=inst.launch_time,
        )
```

对写类 Skill：

```python
# skills/cluster/_any/scale/run.py
def plan(ctx: Ctx) -> PlanResult:
    target = ctx.args["deploy"]
    current = ctx.providers.k8s.get_deployment(ctx.args["ns"], target).spec.replicas
    desired = ctx.args["replicas"]
    return PlanResult(effects=[{
        "target": f"deploy/{target}@{ctx.args['ns']}",
        "kind":   "scale",
        "before": {"replicas": current},
        "after":  {"replicas": desired},
    }])

def run(ctx: Ctx):
    ctx.providers.k8s.scale_deployment(
        ctx.args["ns"], ctx.args["deploy"], ctx.args["replicas"]
    )
```

### 2.2 Ctx 对象（SDK）

```
ctx.args                # 已验证、已类型化的参数
ctx.user                # 当前用户（审计用）
ctx.trace_id            # 贯穿整个 run
ctx.providers.aws       # 受限的 provider client
ctx.providers.gcp
ctx.providers.k8s
ctx.log(msg, **fields)  # 结构化日志，流到 UI
ctx.progress(done, total)   # 进度条
ctx.emit(row)           # 对 output=table 的 yield 等价
ctx.reason              # --reason 的值
```

**SDK 禁用名单**：Skill 代码内 `import subprocess / socket / urllib / requests / os.system / ctypes / __import__('...')` 一律在加载时静态拒绝；网络只能经 provider。

## 3. 生命周期（Lifecycle）

```
    author             reviewer              registry              runtime
  ┌───────┐           ┌─────────┐           ┌─────────┐           ┌────────┐
  │ 新建  │──PR──────▶│ Review  │──merge───▶│ Loaded  │──query───▶│  run   │
  │ 修改  │           │ CI 校验 │           │ indexed │           │        │
  │ 废弃  │           └─────────┘           └─────────┘           └────────┘
  └───────┘                                      │
                                                 ▼
                                          hot-reload on change
```

### 3.1 GitOps 流程

1. Skill 仓库独立于主仓库（允许组织内单独管控）。
2. 作者在分支修改，提 PR 到 `main`。
3. CI 运行：
   - **Schema Lint**：`skill.yaml` 对 JSON Schema 合规。
   - **Static Scan**：`run.py` 不使用禁用名单；不写文件到 `/`；不存在 `eval/exec`。
   - **Unit Test**：`tests/` 下测试至少一条 happy path + 一条 error path。
   - **Golden Parse**：本 Skill 的命令样例能被 Parser 正确产出 AST（回归保护）。
   - **Signed Commit**（v1）：必须通过组织内受信 GPG 签名。
4. 合入 `main` 后，运行时 Watcher 捕获，校验签名/schema → **加载/替换**。加载失败时**保留旧版本**并告警，不让服务降级。
5. 废弃：在 manifest 置 `spec.deprecated: true` 并给出 `replacement`。Registry 仍加载但 UI 上打 warning；N 个版本后删除。

### 3.2 版本与回滚

- Skill 使用 SemVer。MINOR 可以向后兼容新增字段；MAJOR 允许重命名/删除字段。
- 同一 Skill id 在 registry 里只有一个 active 版本；历史版本保留在 Git 中。
- `run` 记录 `skill_commit_sha`，支持按 commit 重放 plan（读类）或至少可审计"当时长这样"。
- 回滚 = `git revert` Skill 仓库对应 commit。Registry 会重新加载前一个版本。

### 3.3 仓库布局

```
slash-skills/                # 独立 git repo（可为子模块）
├─ CODEOWNERS
├─ skill-schema.json
├─ .github/workflows/
│  └─ ci.yml
└─ skills/
   ├─ infra/
   ├─ cluster/
   ├─ app/
   └─ ops/
```

## 4. 沙箱与能力（Capabilities）

Skill 声明的 `capabilities` 是其对外部系统的**权限白名单**。运行时在 plan/preflight 阶段匹配；越权 → 拒绝。

| Capability 命名 | 说明 |
| --- | --- |
| `aws.<service>:<Action>` | 对标 IAM action，如 `aws.ec2:DescribeInstances` |
| `gcp.<service>.<verb>` | 如 `gcp.compute.instances.list` |
| `k8s.<resource>:<verb>` | 如 `k8s.deployment:scale`、`k8s.pod:logs` |
| `slash.audit:read` | 读审计（仅 `/ops audit` 等 Skill 用） |
| `slash.secret:resolve` | 解引用 `@secret/xxx`（不得读值） |

沙箱隔离：
- **进程隔离**：每个 Skill 在独立 Python 子进程运行（`multiprocessing.spawn`）。
- **资源限额**：CPU 时间（`resource.RLIMIT_CPU`）、内存、打开文件数；配置在 Skill manifest。
- **文件系统**：只读挂载 Skill 目录；写只允许 `ctx.workdir`（临时目录，run 结束清理）。
- **网络**：仅能通过 provider client 出网；直接系统调用 `socket.connect` 由 seccomp / ptrace 拒绝（Linux）；macOS demo 下退化为进程内补丁 + 静态扫描。

## 5. 测试规范

每个 Skill 至少包含 3 类测试（Provider 层用 moto / fakes，不打真云）：

1. **契约测试（golden AST）**：确认命令能正确解析为 AST 并绑定到本 Skill。
2. **plan 测试**：
   - Read：plan 为空，`run()` 输出结构匹配 schema。
   - Write：plan 字段完备（before/after/target/kind），幂等。
3. **失败路径**：权限缺失、参数非法、Provider 抛错 → 返回结构化错误而不是崩溃。

CI 中运行 `pytest` + `slash skill lint`。主仓库的集成测试额外使用 kind 集群跑 `/cluster` 类 Skill。

## 6. Skill 示例：`/cluster <ctx> scale`

```yaml
# skills/cluster/_any/scale/skill.yaml
apiVersion: slash/v1
kind: Skill
metadata:
  id: cluster.scale
  name: "Scale a Deployment"
  version: 0.3.0
  labels: { stability: stable, risk: medium }
spec:
  command: { namespace: cluster, target: _any, noun: [], verb: scale }
  # 对于 /cluster，target = kubeconfig context（运行时注入 ctx.cluster_ctx）
  # noun 为空数组：/cluster <ctx> scale <deploy> … 直接是 verb 作用在隐式 "deployment"
  mode: write
  danger: false
  approvers: 1
  timeout: 60s
  args:
    - { name: deploy,    flag: null,        type: string, positional: true, required: true }
    - { name: replicas,  flag: --replicas,  type: int,    required: true, min: 0, max: 1000 }
    - { name: ns,        flag: --ns,        type: string, required: true }
    - { name: reason,    flag: --reason,    type: string, required: true }
  capabilities:
    - k8s.deployment:get
    - k8s.deployment:scale
  output: { kind: object, schema: scale-result }
  plan: { effects: [scale] }
  entrypoint:
    language: python
    file: run.py
    plan_fn: plan
    run_fn: run
```

## 7. 禁止事项（会在 CI/加载时拒绝）

- 使用禁用库（见 §2.2）。
- 不声明 `capabilities` 却访问 provider 资源。
- 声明为 `mode: read` 却实现包含 provider 的写操作（静态分析）。
- `plan()` 内部产生副作用（CI 会 mock provider 的写接口，若被调用则 fail）。
- 在 `run()` 未 `yield` 任何结构化数据却声明 `output.kind: table`。
- 把凭据、token 写到 `ctx.log`（审计过滤器扫描常见 pattern）。

## 8. 命名与治理

- Skill id 小写、点分隔，必须与目录对应：`infra.aws.vm.list`。
- 新增 `noun` 或 `verb` 需先在 [02 命令参考](./02-command-reference.md) 提案变更。
- `CODEOWNERS` 按目录分层（如 `skills/infra/aws/** @aws-team`）。
- 危险 Skill（`danger: true`）需额外的 `SECURITY.md` 评审记录。
