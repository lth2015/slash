# 02 · 命令参考

## 1. 设计原则

1. **一动词一效果**。`list` 只列，`get` 只查，`set` 只改。
2. **显式参数**。全部通过 flag / positional 显式指定，不依赖环境。
3. **一动作 = 一 bash 调用**。命令解析完直接对应一段 bash 模板（见 [04](./04-skills.md)）。
4. **禁止自然语言**。Parser 严格。

## 2. 词法（EBNF，节选）

```
input      = "/" namespace { " " token } ;
namespace  = "infra" | "cluster" | "app" | "ops" ;
token      = flag | word ;
flag       = "--" lower { lower | digit | "-" } [ "=" value ] ;
word       = identifier | quoted_string | number | duration | ref ;
identifier = letter { letter | digit | "-" | "_" | "." | "/" | "=" } ;
duration   = digit+ ("s" | "m" | "h" | "d") ;
ref        = "@" id "/" id ;                    (* 例：@secret/xxx *)
quoted_string = '"' { char | \\" } '"' ;
```

- Token 间**单个空格**。
- 禁用字符：`| & ; ` > < \n \t $(`
- Flag 名必须全小写。

详细解析规则与错误码沿用之前的设计（InvalidToken / UnknownNamespace / UnknownCommand / UnknownFlag / Validation / DuplicateFlag / MissingTarget）。

## 3. 命名空间形态

| 命名空间 | 形态 |
| --- | --- |
| `/infra <provider> <noun_chain> <verb> …` | provider ∈ {aws, gcp} |
| `/cluster <ctx> <noun_chain> <verb> …` | ctx = kubeconfig context |
| `/app <noun_chain> <verb> …` | 无 target |
| `/ops <noun_chain> <verb> …` | 无 target |

**Shape 解析 = Skill 注册表驱动最长前缀匹配**（不是写死的 EBNF）。

## 4. Demo 阶段原子命令（≈10 条）

只列 Demo 必跑通的。每条命令对应一个 Skill 文件（bash 模板见 [04](./04-skills.md)）。

### 4.1 `/infra`（read 为主）

| 命令 | 读/写 | bash 对应 |
| --- | --- | --- |
| `/infra aws vm list [--region <r>] [--tag <k>=<v>]` | R | `aws ec2 describe-instances --region … --profile $AWS_PROFILE` |
| `/infra aws vm get <id> [--region <r>]` | R | `aws ec2 describe-instances --instance-ids <id> --region …` |
| `/infra gcp vm list [--zone <z>]` | R | `gcloud compute instances list --zones <z> --format=json` |

### 4.2 `/cluster` — 扁平动词语法（2026-04 refactor）

`/cluster` 的命令 shape 从「`<verb> <noun>`」**重构为单动词**。ctx 不再是位置参数，必须来自 session pin 或 `--ctx <name>` 覆盖；所有命令对齐 kubectl。

**List 类**（零或一个 flag）：

| 命令 | 读/写 | bash 对应 |
| --- | --- | --- |
| `/cluster pods [--ns <n>] [--selector <k>=<v>]` | R | `kubectl -n <ns> get pods -o json` |
| `/cluster deploys [--ns <n>] [--selector <k>=<v>]` | R | `kubectl -n <ns> get deployments -o json` |
| `/cluster services [--ns <n>]` | R | `kubectl -n <ns> get services -o json` |
| `/cluster events [--ns <n>]` | R | `kubectl get events --sort-by=.lastTimestamp -o json` |
| `/cluster nodes` | R | `kubectl get nodes -o json` |
| `/cluster top [--ns <n>]` | R | `kubectl top pod --no-headers`（CPU/Memory） |

**Single-resource read**：

| 命令 | 读/写 | bash 对应 |
| --- | --- | --- |
| `/cluster describe <pod> --ns <n>` | R | `kubectl -n <ns> describe pod <pod>` |
| `/cluster logs <pod> --ns <n> [--since <d>]` | R | `kubectl -n <ns> logs <pod> --since=<d>` |
| `/cluster get deploy <name> --ns <n>` | R | `kubectl -n <ns> get deploy <name> -o json`（保留 2-token 形态） |
| `/cluster get svc <name> --ns <n>` | R | `kubectl -n <ns> get svc <name> -o json`（保留） |
| `/cluster node describe <name>` | R | `kubectl describe node <name>`（保留） |
| `/cluster diagnose <pod> --ns <n>` | R | aggregate: describe + events + logs → LLM explain |

**Write（HITL）**：

| 命令 | 读/写 | bash 对应 |
| --- | --- | --- |
| `/cluster scale <deploy> --replicas <n> --ns <n> --reason "<t>"` | **W** | `kubectl -n <ns> scale deployment/<deploy> --replicas=<n>` |
| `/cluster restart <deploy> --ns <n> --reason "<t>"` | **W** | `kubectl -n <ns> rollout restart deployment/<deploy>` |
| `/cluster delete <pod> --ns <n> --reason "<t>" [--grace-period <n>]` | **W · danger** | `kubectl -n <ns> delete pod <pod>` |
| `/cluster cordon <node> --reason "<t>"` | **W** | `kubectl cordon <node>` |
| `/cluster uncordon <node> --reason "<t>"` | **W** | `kubectl uncordon <node>` |
| `/cluster drain <node> --reason "<t>" [--force] [--grace-period <n>]` | **W · danger** | `kubectl drain <node> --ignore-daemonsets` |

Ctx 解析：每条命令都接受可选 `--ctx <name>` 覆盖，否则读 session pin（`/ctx pin k8s <name>`）。parser 在执行前做严格检查，未配 ctx 直接 `MissingContext`。

### 4.3 `/ops`

| 命令 | 读/写 | bash 对应 |
| --- | --- | --- |
| `/ops audit logs [--since <d>] [--user <n>]` | R | 本地 `audit.jsonl` 过滤 |
| `/ops diagnose <service>` | R | 组合以上若干 read skill 的结果 + LLM 分析报告 |

> `/ops diagnose` 的"LLM 分析"仅解读数据，不会触发任何写操作。

### 4.4 `/app`（原子集合 · kubectl 为主线后端）

本阶段只做**原子动作**——每条命令一次后端 CLI 调用。backend 统一选 **kubectl**（零新依赖，与 `/cluster` 对齐）。编排层（`ship`/`canary`/`pipeline run`/`predict`/`optimize`/`diagnose`）都不在本阶段，见 `Draft.md` 的 `DEFER` 标注。

| 命令 | 读/写 | bash 对应 | 状态 |
| --- | --- | --- | --- |
| `/app status <name> --ns <n>` | R | `kubectl get deployment <name> -o json` → 取 `.status` | ✅ 已实现 |
| `/app deploy <name> --env <env> --image <ref> --reason "<t>"` | **W · danger** | step 1: `kubectl set image deployment/<name> *=<ref>`  · step 2: `kubectl rollout status deployment/<name>` | 🟡 待实现（需要 runtime 的 sequential bash.steps） |
| `/app rollback <name> --env <env> --reason "<t>"` | **W · danger** | `kubectl rollout undo deployment/<name>` | ❌ 未实现 |
| `/app config get <name> --ns <n>` | R | `kubectl get configmap <name> -o json` | ❌ 未实现 |
| `/app config diff <name> --file <path>` | R | `kubectl diff -f <path>` | ❌ 未实现 |
| `/app config update <name> --file <path> --reason "<t>"` | **W** | `kubectl apply -f <path>` | ❌ 未实现 |
| `/app list` | R | 读本地应用登记表 `~/.config/slash/apps.yaml` 或由 helm/argocd 提供 | ❌ 未实现（backend 二选一或三选一待定） |

> kubectl 路线的好处：`/app` 命令和 `/cluster` 共享 k8s profile、`--ctx` 语义、argv-safety；skill YAML 只是 `/cluster` 的更高级视角（target = 一个 app 而非一个原子资源）。

### Meta commands（不走严格 DSL）

两条 `/`-命令是客户端 meta 指令，**不**经过 parser / runtime，也不触发 HITL。它们在 CommandBar 里会走短路路径，不会红线报错：

| 命令 | 作用 | 实现位置 |
| --- | --- | --- |
| `/clear` | 清空对话流视图。审计追加文件 `.slash/audit/audit.jsonl` **不会**被清掉——历史还可以通过 `/ops audit logs` 查询 | `page.tsx` 客户端拦截 |
| `/help [自然语言问题]` | 只读自助：把当前 skill registry 喂给 Gemini 2.5 Flash，让它用自然语言回答"这个工具能做什么""我想做 X 该用哪条命令"。返回的 `suggested_commands` 必须来自真实 catalog（server 侧白名单过滤），点击只填入 CommandBar，**永不自动执行**。LLM 关闭时走确定性 fallback：分 namespace 列出前几条 read skill | `routers/help.py` + `page.tsx` |

### 4.5 `/ctx`（会话上下文 · 内建 skill，已实现）

不走外部 CLI，读/写 `var/state.json` 里的 pin 状态，供 `/cluster`、`/infra aws`、`/infra gcp` 的严格 ctx 校验使用。

| 命令 | 读/写 | 作用 |
| --- | --- | --- |
| `/ctx list` | R | 列出可选 AWS profile / GCP configuration / kubeconfig context |
| `/ctx show` | R | 显示当前 pin（含 tier：critical / staging / safe） |
| `/ctx pin <kind> <name> --tier <tier>` | W | 把 `kind ∈ {k8s, aws, gcp}` pin 到 `name` |
| `/ctx unpin <kind>` | W | 清除该 kind 的 pin |

> pin 不经审批（纯会话态，不涉及外部写操作），但会被写入 `audit.jsonl`。写类命令落地前会做 drift guard：若 pin 在最近 60s 内改过，会提示二次确认。

## 5. 通用 Flag

| Flag | 说明 |
| --- | --- |
| `--reason "<t>"` | 写操作强制，写入审计 |
| `--yes` | 允许跳过二次确认（仍需 UI 审批卡点击） |
| `--profile <p>` | 覆盖当前 Context Bar 的 profile，仅对本次执行生效 |
| `--timeout <d>` | 覆盖 skill 声明的超时 |
| `--explain` | 本次执行后调用 LLM 生成摘要（默认跟随 Context Bar 的开关） |

## 6. 错误

| 错误码 | 场景 | UI 呈现 |
| --- | --- | --- |
| `ParseError.*` | 语法层（见 §2） | 命令栏红波浪线 + Status 行给 3 个候选 |
| `PreflightFailed` | profile 缺、bash 不可用、资源不存在 | 错误卡，What / Why / How 三段 |
| `Rejected` | 审批拒绝 | 灰色卡，显示拒绝理由 |
| `ExecutionError` | bash 非零退出 | 错误卡 + 原始 stderr 可展开 |
| `Timeout` | 超过 `--timeout` | 错误卡 + 已中止标签 |

## 7. 示例

合法：
```
/infra aws vm list --region us-east-1 --tag env=prod
/cluster prod list pod --ns api --selector app=web
/cluster prod scale web --replicas 5 --ns api --reason "traffic spike"
/ops audit logs --since 7d
```

非法：
```
list vms                                 # 缺前导 /
/infra aws vm list ; rm -rf /            # 禁用字符 ; 和 rm
/cluster prod exec web -- rm             # '--' bare 分隔不支持
帮我查下 prod 的 web 副本                  # 自然语言拒绝
```
