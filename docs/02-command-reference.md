# 02 · 命令参考（Command Reference）

> Slash 是**命令语言**而不是自然语言。本文件是该语言的规范说明。解析器（parser）、命令补全（completion）、Skill 加载器、审计记录、UI 渲染全部以本文件为唯一事实源。

## 1. 设计原则

1. **一动词一效果**：每条原子命令只做一件事。`get` 不改状态；`set` 只改一个字段。
2. **名词优先于动词**：顶层是资源域（`infra/cluster/app/ops`），其下是资源类型，再下是动词。
3. **副作用显式声明**：命令要么是 **read**，要么是 **write**。write 默认需要 `--yes`（或 UI 审批）才执行。
4. **无隐式上下文**：一切目标（集群、环境、项目）作为参数显式传入，不依赖 shell 环境变量。
5. **输出 schema 化**：每条命令声明一个输出 schema，UI 据此渲染；纯文本输出仅用于 log streaming。
6. **禁止自然语言**：解析器对未定义 token、未定义 flag、未知 provider 一律 `ParseError`，不"尽力理解"。

## 2. 形式语法

Slash 的解析分两段：**(a) 词法（EBNF 定义 token）** + **(b) 形态（由 Skill 注册表驱动）**。这样可以在保持严格词法的同时，容纳"复合 noun"（如 `vm snapshot create`）而不引入歧义。

### 2.1 词法（EBNF）

```ebnf
input        = "/" namespace { " " token } ;

namespace    = "infra" | "cluster" | "app" | "ops" ;

token        = flag | word ;
flag         = "--" flag_name [ ("=" | " ") value ] ;
flag_name    = lowercase { lowercase | digit | "-" } ;
word         = identifier | quoted_string | number | duration | ref ;
value        = word ;

identifier   = head { tail } ;
head         = letter | "_" ;                     (* 必须以字母/_ 开头 *)
tail         = letter | digit | "-" | "_" | "." | "/" ;
number       = digit { digit } ;
duration     = number ("s" | "m" | "h" | "d") ;
ref          = "@" identifier "/" identifier ;    (* 例：@secret/db-pw *)
quoted_string = '"' { safe_char | '\"' } '"' ;    (* 反斜杠只转义 " *)

letter       = "a".."z" | "A".."Z" ;
digit        = "0".."9" ;
lowercase    = "a".."z" ;
```

**词法级严格规则：**
- Token 间只接受**单个空格**（多空格即 `ParseError`）。
- `quoted_string` 不做变量展开、不解释反引号、不解 escape（仅 `\"`）。
- 禁止字符：`|`, `&`, `;`, `$(`, `` ` ``, `>`, `<`, `\n`, `\t`。出现即 `ParseError.InvalidToken`。**无 shell 语义。**

### 2.2 形态（Registry-driven resolution）

形态由 Skill 注册表在运行时决定，不在 EBNF 里写死。解析器按以下顺序消解 tokens：

1. 取得 `namespace`。对应的"形状模板"：
   - `/infra <provider> <noun_chain> <verb> …` — `<provider> ∈ {aws, gcp, …}`
   - `/cluster <cluster_ctx> <noun_chain> <verb> …` — 上下文来自 kubeconfig
   - `/app <noun_chain> <verb> …` — 环境以 `--env` 传入
   - `/ops <noun_chain> <verb> …`
2. 若模板要求 target（provider/ctx），消费下一个 word 作 target。
3. **最长前缀匹配** `<noun_chain> <verb>`：从剩余 word 序列的左侧开始，在 Skill 注册表里按命令坐标树（见 [04 §1](./04-skills-system.md)）做 greedy 匹配，找到唯一的 Skill。未命中 → `ParseError.UnknownCommand`，附 Damerau-Levenshtein ≤ 2 的候选。
4. 剩余 tokens 按 Skill manifest 的 `args` schema 绑定（见 [04 §2](./04-skills-system.md)），未声明的 flag/positional 一律拒绝。
5. 复合 noun 的正规写法：**空格分隔**（`vm snapshot create` / `rollout restart`），对应目录 `skills/infra/aws/vm/snapshot/create/`。

> 为什么不把复合 noun 塞进 EBNF？因为合法的 noun 组合取决于当前加载了哪些 Skill；让 EBNF 静态穷举会和实际 Skill 能力脱钩。词法是静态的，形态由能力决定。

### 2.3 其他输入约束

- 未在 Skill manifest 声明的 flag → `ParseError.UnknownFlag`（不 silently ignore）。
- 不做通配符搜索的隐式默认：模糊查询必须显式 `--match <glob>`（glob-only，不用 regex）。
- "枚举"的展示语法 `A | B | C` 只是文档约定；用户实际输入是单值（例：`--type A`）。

## 3. 通用参数（Global Flags）

| Flag | 语义 | 默认 |
| --- | --- | --- |
| `--yes` | 跳过确认，仍然写审计 | `false` |
| `--dry-run` | 产出 Plan 但不执行 | `false` |
| `--output=<json\|table\|yaml\|raw>` | 覆盖默认输出 schema | Skill 声明 |
| `--timeout=<duration>` | 最长等待 | Skill 声明，默认 `30s` |
| `--as=<user>` | 以给定身份记录审计；要求调用者具备 `slash.impersonate` 能力；不绕过审批 | 当前 OS 用户 |
| `--reason="<text>"` | 写入审计的变更理由，write 类强制要求 | — |
| `--trace` | 附带 `trace_id` 方便跨系统关联 | 自动生成 |

**写类命令在无 `--yes`、且无 UI 审批签名时，必须失败并提示进入审批流。**

## 4. 命名空间与原子命令表

### 4.1 `/infra` — 云资源

覆盖资源：`vm | oss | db | lb | dns | net | iam | cert | secret | registry | cost`。

| 命令 | 读/写 | 说明 |
| --- | --- | --- |
| `/infra <p> vm list [--region <r>] [--tag <k>=<v>]` | R | 列 VM |
| `/infra <p> vm get <id>` | R | 详情 |
| `/infra <p> vm start <id>` | W | 启动 |
| `/infra <p> vm stop <id> [--force]` | W | 停止 |
| `/infra <p> vm restart <id>` | W | 重启 |
| `/infra <p> vm resize <id> --type <sku>` | W | 变配 |
| `/infra <p> vm snapshot create <id> --name <n>` | W | 快照 |
| `/infra <p> vm snapshot list <id>` | R | 列快照 |
| `/infra <p> vm backup create <id> --plan <plan>` | W | 备份 |
| `/infra <p> vm backup restore <id> --backup <b>` | W | 恢复（高危，强 HITL） |
| `/infra <p> oss bucket list` | R | 列桶 |
| `/infra <p> oss object list <bucket> [--prefix <p>]` | R | 列对象 |
| `/infra <p> oss object get <bucket> <key> --out <file>` | R | 下载 |
| `/infra <p> oss object put <bucket> <key> --file <file>` | W | 上传 |
| `/infra <p> oss object delete <bucket> <key>` | W | 删除（强 HITL） |
| `/infra <p> db list` | R | 列实例 |
| `/infra <p> db get <id>` | R | 详情 |
| `/infra <p> db restart <id>` | W | 重启 |
| `/infra <p> db slow-log <id> [--since <d>]` | R | 慢日志 |
| `/infra <p> db backup create <id>` | W | 备份 |
| `/infra <p> db backup restore <id> --backup <b> [--target-time <ts>]` | W | 恢复（高危） |
| `/infra <p> lb list` | R | 列 LB |
| `/infra <p> lb get <id>` | R | 详情 |
| `/infra <p> lb status <id>` | R | 健康状态聚合 |
| `/infra <p> lb error-log <id> [--since <d>]` | R | 访问/错误日志 |
| `/infra <p> lb http-errors <id> [--status 5xx\|4xx] [--since <d>] [--group-by path\|upstream]` | R | HTTP 错误聚合（AI 辅助） |
| `/infra <p> dns record list <zone>` | R | 解析记录 |
| `/infra <p> dns record resolve <name> [--type A\|AAAA\|CNAME\|TXT]` | R | 解析查询 |
| `/infra <p> net vpc list` / `... subnet list <vpc>` / `... sg list <vpc>` | R | 网络查询 |
| `/infra <p> net sg rule add <sg> --cidr <c> --port <n> --proto tcp\|udp` | W | 开端口（HITL） |
| `/infra <p> iam role list` / `... policy list` | R | IAM 查询 |
| `/infra <p> cert list` / `... cert get <id>` | R | 证书 |
| `/infra <p> secret list` | R | **只列元数据**，值必须通过 `@secret/<name>` 引用，不回显 |
| `/infra <p> registry repo list` / `... image list <repo>` | R | 镜像仓库 |
| `/infra <p> cost summary [--window 7d\|30d] [--group-by service\|tag]` | R | 成本汇总 |
| `/infra <p> cost audit [--window 30d] [--threshold <usd>]` | R | 异常支出审计 |
| `/infra <p> cost optimize [--scope vm\|oss\|db]` | R | 优化建议（AI 辅助） |

### 4.2 `/cluster` — Kubernetes

`<ctx>` 是 kubeconfig context 名，**必填**。

| 命令 | 读/写 | 说明 |
| --- | --- | --- |
| `/cluster <ctx> get <kind> <name> [--ns <n>] [--field <path>]` | R | 取字段 |
| `/cluster <ctx> list <kind> [--ns <n>] [--selector <k>=<v>]` | R | 列出 |
| `/cluster <ctx> describe <kind> <name> [--ns <n>]` | R | 人类可读聚合 |
| `/cluster <ctx> events <kind> <name> [--ns <n>] [--since <d>]` | R | 事件 |
| `/cluster <ctx> logs <pod> [--ns <n>] [--container <c>] [--since <d>] [--follow]` | R | 日志 |
| `/cluster <ctx> apply --file <path>` | W | 应用 manifest（强 HITL，Plan 生成 diff） |
| `/cluster <ctx> rollout status <deploy> [--ns <n>]` | R | 发布状态 |
| `/cluster <ctx> rollout restart <deploy> [--ns <n>]` | W | 重启 |
| `/cluster <ctx> rollout undo <deploy> [--ns <n>] [--to-revision <r>]` | W | 回滚 |
| `/cluster <ctx> scale <deploy> --replicas <n> [--ns <n>]` | W | 扩缩 |
| `/cluster <ctx> cordon <node>` / `uncordon <node>` | W | 标记不可调度 |
| `/cluster <ctx> drain <node> [--grace-period <d>] [--ignore-daemonsets]` | W | 驱逐 |
| `/cluster <ctx> evict <pod> [--ns <n>]` | W | 驱逐单 Pod |
| `/cluster <ctx> top node` / `top pod [--ns <n>]` | R | 资源用量 |
| `/cluster <ctx> ns list` / `ns get <n>` | R | 命名空间 |
| `/cluster <ctx> port-forward <pod> --local <port> --remote <port> [--ns <n>]` | W | 转发（仅本机；端口用整数） |
| `/cluster <ctx> exec <pod> --command "<line>" [--ns <n>] [--container <c>]` | W | 执行（默认禁用，白名单开启；整条命令必须 quoted，不解释 shell） |
| `/cluster <ctx> diagnose <pod> [--ns <n>]` | R | 故障聚合报告（AI 辅助） |
| `/cluster <ctx> predict <metric> --target <deploy> [--window 7d]` | R | 容量预测 |
| `/cluster <ctx> optimize <deploy> [--ns <n>]` | R | 资源建议 |

### 4.3 `/app` — 应用交付

环境 `<env>` 来自注册表（`app.envs`）。

| 命令 | 读/写 | 说明 |
| --- | --- | --- |
| `/app list` | R | 应用清单 |
| `/app get <name>` | R | 应用元数据 |
| `/app pipeline list [--name <n>]` | R | 流水线 |
| `/app pipeline describe <job>` | R | 详情 |
| `/app pipeline run <job> [--param <k>=<v>]` | W | 触发（HITL） |
| `/app pipeline stop <job>` | W | 停止 |
| `/app pipeline delete <job>` | W | 删除（强 HITL） |
| `/app pipeline trace <job>` | R | 调用链 |
| `/app release list <name> --env <env>` | R | 历史版本 |
| `/app release diff <name> --env <env> --from <v1> --to <v2>` | R | 版本 diff |
| `/app ship <name> --tag <version> --env <env>` | W | 首次上线 / 直接部署 |
| `/app release promote <name> --env <env> --from <src-env>` | W | 跨环境晋级（HITL） |
| `/app rollback <name> --env <env> [--to-version <v>]` | W | 回滚 |
| `/app canary <name> --env <env> --weight <0..100>` | W | 金丝雀权重 |
| `/app config get <name> --env <env> [--key <k>]` | R | 取配置 |
| `/app config update <name> --env <env> --file <path>` | W | 更新配置（Plan 生成 diff，强 HITL） |
| `/app config diff <name> --env <env> --from <src-env>` | R | 配置 diff |
| `/app feature-flag list <name> --env <env>` | R | 列 flag |
| `/app feature-flag set <name> --env <env> --key <k> --value <v>` | W | 置 flag（HITL） |
| `/app secret bind <name> --env <env> --key <k> --ref @secret/<name>` | W | 绑定 Secret 引用 |
| `/app secret unbind <name> --env <env> --key <k>` | W | 解绑 |
| `/app diagnose <name> --env <env>` | R | 故障聚合（AI 辅助） |
| `/app predict <name> --env <env> --metric <m>` | R | 负载预测 |
| `/app optimize <name> --env <env>` | R | 优化建议 |

### 4.4 `/ops` — 运维与值班

| 命令 | 读/写 | 说明 |
| --- | --- | --- |
| `/ops alert list [--severity <s>] [--since <d>]` | R | 列告警 |
| `/ops alert get <id>` | R | 详情 |
| `/ops alert ack <id> --reason "<text>"` | W | 认领 |
| `/ops alert mute <id> --duration <d> --reason "<text>"` | W | 静音 |
| `/ops trace <trace-id>` | R | trace 聚合 |
| `/ops top-errors <service> [--since <d>]` | R | 错误 top |
| `/ops scan <service>` | R | 快速健康巡检 |
| `/ops audit logs [--user <n>] [--command <prefix>] [--since <d>]` | R | 审计查询 |
| `/ops report generate daily\|weekly` | W | 生成报告（写产物） |
| `/ops report view <report-id>` | R | 查看 |
| `/ops runbook list` | R | 可用 runbook |
| `/ops runbook run <name> [--param <k>=<v>]` | W | 执行具名 runbook（内部由 N 条 Skill 组成，HITL 每步） |
| `/ops incident open --title "<t>" [--severity <s>]` | W | 开事件单 |
| `/ops incident close <id> --postmortem <url>` | W | 关闭 |
| `/ops incident link <id> --trace <trace-id>` | W | 关联 trace |
| `/ops slo status <service>` | R | SLO/SLI |

## 5. 解析与错误模型

### 5.1 解析阶段

1. **Tokenize**：按 [§2.1 EBNF](#21-词法ebnf) 切 token，非法字符 → `ParseError.InvalidToken`。
2. **Shape**：按命名空间的形状模板消费 target（如适用），在 Skill 注册表里对剩余 words 做 [§2.2](#22-形态registry-driven-resolution) 的最长前缀匹配；未命中 → `ParseError.UnknownCommand`，附最近 3 个候选（Damerau-Levenshtein 距离 ≤ 2）。
3. **Bind**：根据 Skill manifest 绑定 flag / positional 到类型；未声明 flag → `ParseError.UnknownFlag`。
4. **Validate**：类型校验、枚举校验、`ref` 解引用（不取值，只验证存在）；失败 → `ParseError.Validation`。

### 5.2 执行阶段

| 错误类型 | 条件 | UI 呈现 |
| --- | --- | --- |
| `PreflightFailed` | 权限不足、Provider 不可用、依赖资源不存在 | 红色，列出失败条目 |
| `PlanRejected` | 用户在审批页面拒绝 | 灰色，显示拒绝理由 |
| `ExecutionError` | 远端 API 错误、超时 | 红色，附原始错误与 `trace_id` |
| `PartialSuccess` | 批量操作部分成功 | 黄色，逐项结果 |

### 5.3 退出码（给未来 CLI 版本使用）

| 码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 2 | ParseError |
| 3 | PreflightFailed |
| 4 | PlanRejected |
| 5 | ExecutionError |
| 6 | PartialSuccess |
| 7 | Timeout |

## 6. 命令补全（Completion）

补全由 Skill 注册表驱动，**不猜测**。对当前 token 的补全规则：

1. 若光标处是 `namespace`：给四个顶层。
2. 若 `namespace` 已确定：从 manifest 取该 ns 下允许的 provider / cluster context / env。
3. 若 `noun/verb` 未定：按 Skill 注册表枚举。
4. 若在 `flag` 位置：按 Skill manifest 的 `args` schema 给。flag 的值如果有 `enum / provider`（来源于 Provider API，如 VM 列表）→ 查询 Provider 返回候选。
5. 无匹配时显示 `— no suggestions —`，**永远不编造**。

## 7. 输出 schema

每个 Skill 在 manifest 中声明输出 schema：

```yaml
output:
  kind: table          # table | object | log-stream | report
  columns:
    - { key: id,    label: "ID",    width: 16 }
    - { key: name,  label: "Name",  width: 24 }
    - { key: state, label: "State", renderer: badge }
    - { key: region, label: "Region" }
  sort_by: name
  row_key: id
```

UI 严格按 schema 渲染，不做字段推断。

## 8. 示例（合法 / 非法对照）

合法：
```
/infra aws vm list --region us-east-1 --tag env=prod
/cluster kind-sre get pod web-abc --ns api --field status.phase
/app config update checkout --env staging --file ./cfg.yaml --reason "lower timeout"
```

非法：
```
/infra aws vms list                        # ParseError.UnknownCommand: vms (suggest: vm)
/cluster kind-sre get pod web-abc -n api   # ParseError.UnknownFlag: -n (use --ns)
list vms on aws please                     # ParseError.InvalidToken (missing leading "/")
/infra aws vm list --region us-east-1;rm   # ParseError.InvalidToken (';' not allowed)
/cluster c exec web -- ls /tmp             # ParseError.InvalidToken ('--' 分隔不支持；用 --command "ls /tmp")
/cluster c port-forward web 3000:8080      # ParseError.InvalidToken (':' 不是合法 word；用 --local 3000 --remote 8080)
```
