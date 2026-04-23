# 04 · Skill 体系

## 1. 原则

**Skill = YAML 清单 + 一段 bash 模板 + 一组测试**。不再有 Python SDK、不再有沙箱子进程与复杂 capability。

- 原子性：一个 Skill 做一件事。
- 可验证：每个 Skill 配 harness（见 §5），CI gate 通过才能上。
- 可审计：所有执行进 `audit.jsonl`。
- 可回滚：所有 write Skill 必有"回滚提示"字段（给人看的、不自动执行）。

## 2. 目录 = 命令坐标

```
skills/
├─ infra/aws/vm/list/
│  ├─ skill.yaml
│  └─ tests/                  # harness
│     ├─ cases.yaml
│     └─ fixtures/
│        ├─ aws-ec2-happy.json
│        └─ aws-ec2-empty.json
├─ infra/aws/vm/get/
├─ infra/gcp/vm/list/
├─ cluster/_any/list/pod/
├─ cluster/_any/get/deploy/
├─ cluster/_any/logs/
├─ cluster/_any/scale/
├─ cluster/_any/rollout/restart/
├─ ops/audit/logs/
└─ ops/diagnose/
```

## 3. 清单 (`skill.yaml`)

完整示例 — `skills/infra/aws/vm/list/skill.yaml`：

```yaml
apiVersion: slash/v1
kind: Skill
metadata:
  id: infra.aws.vm.list
  name: "List AWS VMs"
  description: "List EC2 instances in a region."   # 1-liner shown in the command palette
  version: 0.1.0
  owners: ["sre@example.com"]
  labels: { stability: beta, risk: low }

spec:
  command: { namespace: infra, target: aws, noun: [vm], verb: list }
  mode: read
  danger: false
  approvers: 0
  timeout: 30s

  # ---- profile source ----
  profile:
    kind: aws            # aws | gcp | k8s
    required: true       # 执行前检查凭据是否就位

  # ---- preflight (optional) ----
  # Blocking argv check run before bash.argv. Non-zero exit => PreflightFailed,
  # bash.argv is never executed. For write skills, preflight is also replayed at
  # approve-time so that a deleted-since-plan resource is caught before apply.
  # preflight:
  #   argv: [kubectl, --context, "${profile.k8s.context}", -n, "${ns}",
  #          get, deployment, "${deploy}"]

  # ---- strongly typed args ----
  args:
    - { name: region, flag: --region, type: string, default: "us-east-1" }
    - { name: tag,    flag: --tag,    type: "map<string,string>", repeatable: true }

  # ---- bash execution ----
  #
  # `argv` is a list. Each element may reference ${name} / ${name[key]}.
  # Values are interpolated SAFELY (list substitution, no shell parsing).
  # For repeatable tags we expand to multiple argv entries via `expand`.
  #
  bash:
    argv:
      - aws
      - ec2
      - describe-instances
      - --region
      - "${region}"
      - --output
      - json
    expand:
      - when: tag
        as: ["--filters", "Name=tag:${key},Values=${value}"]
    env:
      AWS_PROFILE: "${profile.aws}"      # injected by runtime
    timeout: 30s

  # ---- multi-step writes: bash.steps (alternative to bash.argv) ----
  #
  # Some writes take more than one CLI call — e.g. /app deploy is:
  #   1. kubectl set image deployment/<name> <container>=<image>
  #   2. kubectl rollout status deployment/<name> --timeout=...
  #
  # Declare them as ordered steps in place of a single argv. Runtime executes
  # them through the SAME `execute()` entry, short-circuits on the first
  # non-zero exit, and returns per-step results (id, exit_code, duration_ms,
  # started_at/ended_at, argv) that the PlanCard / ResultCard surface.
  #
  #   bash:
  #     steps:
  #       - id: set_image
  #         argv: [kubectl, -n, "${ns}", set, image,
  #                "deployment/${name}", "*=${image}"]
  #       - id: wait_rollout
  #         argv: [kubectl, -n, "${ns}", rollout, status,
  #                "deployment/${name}", "--timeout=180s"]
  #
  # spec.bash.argv, spec.bash.steps, and spec.builtin are MUTUALLY EXCLUSIVE.
  # Loader rejects any manifest that declares two of them.

  # ---- output rendering ----
  output:
    parse: json
    # jq-like selector that narrows down to a list of rows
    path: "Reservations[].Instances[]"
    # Optional: which exit codes count as success (default [0]). Useful for CLIs
    # that return a non-zero "nothing matched" code without actually erroring.
    # success_codes: [0, 2]
    columns:
      - { key: InstanceId,  label: "ID",       width: 20 }
      - { key: Tags.Name,   label: "Name",     width: 28, fallback: "-" }
      - { key: State.Name,  label: "State",    renderer: state-badge }
      - { key: InstanceType,label: "Type" }
      - { key: Placement.AvailabilityZone, label: "AZ" }
      - { key: LaunchTime,  label: "Launched", renderer: relative-time }

  # ---- rollback (for write skills; optional) ----
  #
  # Two forms:
  #
  #   1. Prose hint  — any string that does NOT start with "/". Rendered on
  #      the Plan card as a human-readable note. No one-click rollback.
  #
  #   2. Executable slash command — MUST start with "/". Interpolated at
  #      plan time with the usual ${var} substitutions PLUS ${before} and
  #      ${after} (from the plan.diff capture). After a successful apply the
  #      UI shows a "Roll back" button that pre-fills the CommandBar with
  #      this command. The rollback itself goes through /execute + HITL
  #      approval like any other write — there is no fire-and-forget revert.
  #
  # Example (see skills/cluster/_any/scale/skill.yaml):
  #   rollback: "/cluster ${profile.k8s.context} scale ${deploy} --replicas ${before} --ns ${ns} --reason rollback"
  rollback: null

  # ---- LLM summary template (optional; used when Context Bar LLM is ON) ----
  explain:
    goal: "summary"          # "summary" | "diagnose"
    style: "concise"         # concise | detailed
```

### 3.1 Write skill 示例 — `skills/cluster/_any/scale/skill.yaml`

```yaml
metadata: { id: cluster.scale, version: 0.1.0, labels: { risk: medium } }
spec:
  command: { namespace: cluster, target: _any, noun: [], verb: scale }
  mode: write
  danger: false
  approvers: 1
  timeout: 60s

  profile: { kind: k8s, required: true }

  args:
    - { name: deploy,   type: string, positional: true, required: true }
    - { name: replicas, flag: --replicas, type: int, required: true, min: 0, max: 1000 }
    - { name: ns,       flag: --ns,       type: string, required: true }
    - { name: reason,   flag: --reason,   type: string, required: true }

  plan:
    # Optional: a cheap read-only bash that renders before/after diff.
    # Its stdout is rendered into the ApprovalCard's diff pane.
    argv: [kubectl, --context, "${profile.k8s.context}", -n, "${ns}",
           get, deployment, "${deploy}", -o, "jsonpath={.spec.replicas}"]
    diff:
      before_source: stdout        # kubectl output
      after_value: "${replicas}"

  bash:
    argv: [kubectl, --context, "${profile.k8s.context}", -n, "${ns}",
           scale, "deployment/${deploy}", "--replicas=${replicas}"]

  rollback: |
    To revert: /cluster ${profile.k8s.context} scale ${deploy} --replicas ${plan.before} --ns ${ns} --reason "rollback"

  output: { parse: text }
```

### 3.2 Danger skill 示例 — `skills/infra/aws/vm/stop/skill.yaml`

```yaml
spec:
  command: { namespace: infra, target: aws, noun: [vm], verb: stop }
  mode: write
  danger: true               # 触发 UI 二次确认（输入 YES 才可批准）
  approvers: 1               # demo 阶段单人；prod 建议 2
  ...
```

### 3.3 LLM-composition skill 示例 — `skills/cluster/_any/diagnose/skill.yaml`

诊断类技能不直接跑 bash，而是**把若干 read skill 的结果聚合成一个证据包**，再交由 `/explain` 让 Gemini 给出分析。用 `builtin: aggregate`：

```yaml
spec:
  command: { namespace: cluster, target: _any, noun: [], verb: diagnose }
  mode: read
  args:
    - { name: pod, type: string, positional: true, required: true }
    - { name: ns,  flag: --ns, type: string, required: true }

  builtin: aggregate
  builtin_config:
    steps:
      - id: pod_state
        run: "/cluster ${profile.k8s.context} describe pod ${pod} --ns ${ns}"
      - id: events
        run: "/cluster ${profile.k8s.context} get event --ns ${ns}"
      - id: logs_last_30m
        run: "/cluster ${profile.k8s.context} logs ${pod} --ns ${ns} --since 30m"

  output: { kind: object }
```

**Aggregate 契约（严格）：**

- 每一步的 `run` 是 slash 命令，字符串模板里的 `${var}` 使用父命令的 ctx 插值。
- **只允许 read skill** —— aggregate 不递归执行 write 或其他 aggregate。
- 一个子步骤失败**不阻塞其它步骤**，错误记录在该 step 的 `error` 字段里，整体仍返回 `state: ok`，留给 LLM 解释部分数据。
- 每个子调用**独立走 /execute 全链路**（preflight、bash、output 解析、audit 写入），所以聚合过程本身也是可审计的。
- 结果结构：`{"steps": {step_id: {state, outputs, skill_id, command, duration_ms, error}}}`。UI 以 `kind: object` 渲染，LLM 拿到同样的 JSON 做诊断摘要。

## 4. 参数类型

| 类型 | 例 | 校验 |
| --- | --- | --- |
| `string` | `"us-east-1"` | 可加 `enum`、`pattern` |
| `int` | `5` | `min` / `max` |
| `bool` | `true` / `false` | 无值 flag 等价 `true` |
| `duration` | `30s` / `7d` | 正则 `^[0-9]+[smhd]$` |
| `map<string,string>` | `env=prod` | `key=value`；`repeatable: true` 时多次出现合并 |
| `ref` | `@secret/db-pw` | 格式校验，运行时**只校验存在**不取值（Demo 阶段 `@ref` 只用于审计展示，不对接外部 Secret Manager） |
| `enum` | `--out json\|table\|yaml` | 静态列表 |

所有参数**以 argv 数组传给 subprocess**，**禁止**拼接到 shell 字符串。

## 5. Harness engineering（雕琢 skill 到 SRE 生产水平）

每个 Skill 配一个 `tests/cases.yaml`，运行时可以离线回放真实 bash 的 stdout：

```yaml
# skills/infra/aws/vm/list/tests/cases.yaml
cases:
  - name: "happy path"
    input: "/infra aws vm list --region us-east-1"
    mock:
      stdout: "happy.json"   # path relative to this skill's tests/fixtures/
      exit: 0
    expect:
      state: "ok"            # ok | error | awaiting_approval
      outputs_len: 2         # len(outputs); drop the key to skip
      outputs_row0:          # dotted-path lookups into outputs[0]
        InstanceId: "i-0a1b2c3d"
        State.Name: "running"

  - name: "empty region"
    input: "/infra aws vm list --region eu-west-2"
    mock: { stdout: "empty.json", exit: 0 }
    expect: { state: "ok", outputs_len: 0 }

  - name: "aws exec error surfaces ExecutionError"
    input: "/infra aws vm list --region us-east-1"
    mock:
      stdout: "empty.json"
      exit: 254
      stderr: "An error occurred (AuthFailure) ..."
    expect:
      state: "error"
      error_code: "ExecutionError"
```

**Harness loop** — the runner lives at `apps/api/tests/test_harness.py` and
parametrizes one pytest test per `(skill, case)`:
1. Auto-discover `skills/**/tests/cases.yaml` at collection time.
2. For each case: set `SLASH_MOCK_STDOUT_PATH` / `SLASH_MOCK_EXIT` /
   `SLASH_MOCK_STDERR` via `monkeypatch`, POST `/execute` with
   `{text: case.input}`, assert the response against `expect`.
3. The subprocess mock layer lives in `runtime/executor.py` — when those env
   vars are set, `execute()` returns synthesised RunResult without ever
   touching a real shell.

**What harness covers today**: read-path skills (`state: ok / error` plus
output shape). **Not yet covered**: write skills' full approve cycle,
timeouts (`SLASH_MOCK_LATENCY_MS` is wired but untested), shell-injection
cases (parser already blocks them in `test_parser.py`).

## 6. 加载与热更新

- 启动时 `load_registry(skills/)` 扫目录，校验 schema，重复命令报错，失败启动。
- 每次命令执行前 `reload_if_changed()`：文件 mtime 比对；开发时改完 YAML 立即生效。
- **版本**是 metadata 字段，用作审计参考，不做多版本并存。

## 7. 安全守则

- 参数绝不以字符串拼接进 bash。只能走 `argv` 数组。
- `expand` / 模板里的 `${var}`、`${key}`、`${value}` 的值**一律作为单个 argv 元素**出现，不会被 shell 再次分词。
- `env` 字段只允许 profile 注入与白名单环境变量，不允许任意用户输入进 env。
- `profile.required: true` 下，若 preflight 失败（凭据缺）直接拒绝执行。
- `danger: true` 下二次确认；`approvers >= 2` 在 Demo 暂不启用（架构留位）。
