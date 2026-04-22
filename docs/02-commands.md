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

### 4.2 `/cluster <ctx>`

| 命令 | 读/写 | bash 对应 |
| --- | --- | --- |
| `/cluster <ctx> list pod [--ns <n>] [--selector <k>=<v>]` | R | `kubectl --context <ctx> -n <ns> get pods -o json` |
| `/cluster <ctx> get deploy <name> [--ns <n>]` | R | `kubectl … get deploy <name> -o json` |
| `/cluster <ctx> logs <pod> [--ns <n>] [--since <d>]` | R | `kubectl … logs <pod> --since=<d>` |
| `/cluster <ctx> scale <deploy> --replicas <n> --ns <n> --reason "<t>"` | **W** | `kubectl … scale deployment/<deploy> --replicas=<n>` |
| `/cluster <ctx> rollout restart <deploy> --ns <n> --reason "<t>"` | **W** | `kubectl … rollout restart deploy/<deploy>` |
| `/cluster <ctx> top pod [--ns <n>]` | R | `kubectl … top pod -o json`（数据驱动折线图 Result 卡） |

### 4.3 `/ops`

| 命令 | 读/写 | bash 对应 |
| --- | --- | --- |
| `/ops audit logs [--since <d>] [--user <n>]` | R | 本地 `audit.jsonl` 过滤 |
| `/ops diagnose <service>` | R | 组合以上若干 read skill 的结果 + LLM 分析报告 |

> `/ops diagnose` 的"LLM 分析"仅解读数据，不会触发任何写操作。

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
