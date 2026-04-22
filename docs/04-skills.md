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
    required: true       # 执行前 preflight 检查凭据

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

  # ---- output rendering ----
  output:
    parse: json
    # jq-like selector that narrows down to a list of rows
    path: "Reservations[].Instances[]"
    columns:
      - { key: InstanceId,  label: "ID",       width: 20 }
      - { key: Tags.Name,   label: "Name",     width: 28, fallback: "-" }
      - { key: State.Name,  label: "State",    renderer: state-badge }
      - { key: InstanceType,label: "Type" }
      - { key: Placement.AvailabilityZone, label: "AZ" }
      - { key: LaunchTime,  label: "Launched", renderer: relative-time }

  # ---- rollback hint (for write skills; required there; empty for read) ----
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
  - name: happy path
    args: { region: us-east-1, tag: { env: prod } }
    mock_stdout: fixtures/aws-ec2-happy.json
    expect:
      state: ok
      rows_min: 1
      contains_columns: [InstanceId, State.Name]

  - name: empty
    args: { region: eu-north-1 }
    mock_stdout: fixtures/aws-ec2-empty.json
    expect: { state: ok, rows: 0 }

  - name: permission denied
    args: { region: us-east-1 }
    mock_exit: 254
    mock_stderr: "An error occurred (UnauthorizedOperation) ..."
    expect:
      state: error
      error_code: PreflightFailed
      hint_contains: "UnauthorizedOperation"

  - name: slow → timeout
    args: { region: us-east-1 }
    mock_latency: 60s
    expect:
      state: error
      error_code: Timeout

  - name: injection attempt
    args: { region: 'us-east-1; rm -rf /' }
    expect:
      state: error
      error_code: ParseError.InvalidToken   # parser 早拦，不会走到 runtime
```

**Harness loop**（每次 Skill 改动执行）：
1. **Unit** — mock bash 的 stdout / stderr / exit / latency，验证 runtime 把结果渲染成期望的 Result 卡 schema。
2. **Smoke** — 对可接 mock 的 provider：AWS 用 `moto`、K8s 用 `kind`。这些是 opt-in，本机装好再跑。
3. **Chaos** — 断网、超时、权限错误、返回非法 JSON 都要有明确错误卡，不得 500。
4. **Injection** — 参数里塞 shell metachar、反引号、`$( )`、换行；期望 parser 早拦。
5. **Replay** — 给定真实 run 的 fixture，验证一次历史运行"现在还能解释"（防 skill 改坏）。

CI `apps/api/tests/test_skill_harness.py` 自动跑 `skills/**/cases.yaml`，失败即 PR 红。

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
