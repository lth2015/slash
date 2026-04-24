# 07 · v0.6.0 验收计划

> 目的：逐项过一遍本版本新增的 skill / 视图 / 交互 / 修复。每项给"怎么触发"和"期望看到什么"。不通过就在条目下写一行"问题：…"，我按你写的优化。

> **v0.6.1（自动交互扫雷）**：你午休期间我自己扫了一遍交互面，发现并修了这些问题，已 push master。下面验收时这些应该已经是正常行为：
> - **CommandBar 快速输入丢字符**（核心 bug）：`/ctx list` 快速敲会变成 `/ list`。已用 prefix-detection 重写 sync 逻辑（stateless，更简单更健壮）。
> - **CommandBar 输入框点击 chip 后 Enter 不执行**：焦点留在按钮，Enter 变成重新点按钮。现在外部 fill 会拉回 editor focus。
> - **CommandBar 提交后没清空**：fast-type + 立即 submit 场景下，bar 会卡住显示刚跑完的命令。已修。
> - **`/help` chip 占位符不自动选中**：点"/cluster pod events <pod>..."后需要手动选 `<pod>` 才能替换。现在自动选中第一个 `<>` 占位符，输入即替换，Tab 跳下一个。
> - **`/help` 关键词覆盖不够**：crashloop / oom / imagepullbackoff / 根因 等 SRE 词不命中。补了 ~14 对同义词。
> - **EventTimeline 噪音大**：每行 3 个 action chip，非 Pod 事件的 chip 甚至是不适用的。改为 Pod 事件 only + hover 显现。
> - **LogView 空输出白板**：`/cluster logs --since 1m` 没输出时渲染成灰色空矩形像 bug。改成 "No output" 空状态。

## 前置

- [ ] Web 可达：http://127.0.0.1:4455 （LAN：`http://<你的 IP>:4455`）
- [ ] API 可达：http://127.0.0.1:4456
- [ ] `/skills` 返回 **53** 条（`curl http://127.0.0.1:4456/skills | jq '.count'`）
- [ ] Context Bar 有至少一个 pin（不 pin 大多数命令跑不起来）

---

## 一、6 条新 skill

### 1.1 `/app rollback <name> --ns <ns> --reason "<t>"` — W·danger

- [ ] 敲 `/app rollback <你某个 deployment> --ns <ns> --reason "验收"`
- [ ] **期望**：进入 HITL 审批卡，红条顶栏、需要输入 `YES` 解锁 Approve
- [ ] Plan 卡显示 target `deploy/<name>`、当前镜像 → `previous revision` 的 before/after
- [ ] Approve 后执行 `kubectl rollout undo`，成功返回日志视图
- 问题：

### 1.2 `/cluster rollout status <deploy> --ns <ns> [--timeout 60s]`

- [ ] 敲 `/cluster rollout status <deploy> --ns <ns>`
- [ ] **期望**：一个醒目的状态横幅——`Rolled out ✓`（绿）或 `Rolling ◐`（黄）或 `Timed out ✕`（红）
- [ ] 旁边显示 `deployment` 名 + `N/M replicas ready`
- [ ] 底部折叠的 kubectl 原文可滚动查看
- 问题：

### 1.3 `/cluster pod events <pod> --ns <ns>`

- [ ] 敲 `/cluster pod events <一个有问题的 pod> --ns <ns>`
- [ ] **期望**：**垂直时间线**，每条事件带圆点+连线；Warning 红、Normal 绿
- [ ] 顶部有聚合条："N events · K warnings" + 按 reason 分组红 chip（`3 × BackOff` 之类）
- [ ] 事件 `count > 1` 显示 `×7` 累计角标
- [ ] 每条事件下方有 "Describe pod"、"Tail logs" 两个 chip，点击不自动运行，只填 CommandBar
- 问题：

### 1.4 `/infra aws sg rules <sg-id> [--region <r>]`

- [ ] 敲 `/infra aws sg rules <某个 sg id>`
- [ ] **期望**：两段独立表格 `Ingress · N` 和 `Egress · N`
- [ ] 若有 `0.0.0.0/0`，顶部会显示 `N world-open` 红标
- [ ] 每行：协议 / 端口 / 来源（world-open 红底，SG 引用橙底）/ 备注
- 问题：

### 1.5 `/infra aws vm metrics <id> [--metric CPUUtilization|NetworkIn|…] [--minutes 60]`

- [ ] 敲 `/infra aws vm metrics <instance-id> --minutes 60`
- [ ] **期望**：单指标面积图 + **峰值橙色圆点**
- [ ] 上方 KPI：最新值 · Peak · Average · Datapoints
- [ ] 下方时间轴：起止相对时间
- [ ] 试 `--metric NetworkIn` 切换，单位自动变为 B/s
- 问题：

### 1.6 `/infra aws vm dashboard <id> [--hours 24]`⭐ 压箱底

- [ ] 敲 `/infra aws vm dashboard <instance-id> --hours 24`
- [ ] **期望**：**3 条独立面板**叠放：CPU%、NetIn B/s、NetOut B/s
- [ ] 顶部 3 个色块图例 + 每条的 peak/avg/pts 数字
- [ ] 每条曲线有独立渐变色（品牌橙 / 蓝 / 青）+ 峰值圆点标注
- [ ] 底部显示"24h window"时间跨度
- 问题：

---

## 二、视图升级（既有 skill 的显示改进）

### 2.1 `/ctx list` — 从 JSON dump 升级为 Inventory 视图

- [ ] 敲 `/ctx list`
- [ ] **期望**：
  - 顶部 pin 状态条（黄色警示/橙色已 pin 胶囊）
  - 三段分区 Kubernetes · AWS · GCP，带图标 + 数量 + 分隔线
  - 每条 context 作为可点击的 chip；长 ARN/GKE 路径自动提取 cluster 名，右角小标 `EKS`/`GKE`
  - 当前 pin 的 chip 品牌橙实心、不可点
  - 点击任意非 pin chip → CommandBar 填入 `/ctx pin <kind> <name> --tier safe`，**不自动执行**
  - ≥8 条自动出现过滤框
- 问题：

### 2.2 `/cluster events --ns <ns>` — 升级为 event-timeline

- [ ] 敲 `/cluster events --ns <ns>`
- [ ] **期望**：同 1.3，但覆盖整个 namespace 的事件；高 Warning 时顶部红条提示
- [ ] 每行新增 3 个 chip：Pod events / Describe pod / Tail logs
- 问题：

---

## 三、TableView 交互增强（≥6 行的表格自动生效）

验收用 `/cluster pods --ns <ns>` 或 `/infra aws vm list` 等任意返回多行的 skill。

### 3.1 搜索过滤

- [ ] 返回 ≥6 行时，表顶出现 🔍 过滤框 + `N rows` 计数
- [ ] 输入关键词，实时过滤；计数变为 `matched / total`
- [ ] 无匹配时：显示 "No rows match 'xxx'" + `clear search` 链接
- [ ] `clear` 按钮能恢复全表
- 问题：

### 3.2 20 行截断 + show all

- [ ] 返回 >20 行时，表底出现金色 `+ N more rows · show all` chip
- [ ] 点击后展开全部行
- [ ] 搜索期间自动禁用截断（搜索结果全显示）
- 问题：

### 3.3 行级展开详情

- [ ] 每行最左侧有 ▶ 折叠箭头
- [ ] 点击任意行展开：下方详情面板显示该行全量字段的 dl（key/value）
- [ ] 表格中已作为列展示的 key 标签为浅灰，未展示的 key 为深色（层级感）
- [ ] 有 `row_actions` 时详情面板底部显示为整行品牌橙按钮
- [ ] 再次点击行收起
- 问题：

---

## 四、CommandBar 修复

### 4.1 Enter 键双击 bug 修复

- [ ] 敲 `/ctx list` → 按一次 Enter → 立即执行（不是填入 CommandBar 再按一次）
- [ ] 同样测：`/cluster pods`、`/ops report`、`/ctx show`
- [ ] 反例：空输入 + 打开下拉 → Enter 仍走补全（这个不该改）
- [ ] 反例：带 `<placeholder>` 的前缀 → Enter 仍走补全
- 问题：

---

## 五、`/help` 关键词匹配

### 5.1 LLM 关着时的智能 fallback

- [ ] Context Bar 确认 LLM toggle OFF
- [ ] 敲 `/help 我想查看某个ec2的状态，只知道关键词`
- [ ] **期望**：`summary` 首句是 "Top picks for …"
- [ ] `highlights` 列出 `vm get / vm list --tag / vm dashboard / vm metrics / vpc list` 等
- [ ] `suggested_commands` 6 个 chip，点击填 CommandBar 不自动跑
- [ ] 底部 findings 提示 "llm toggle is off"
- 问题：

### 5.2 中英混杂验证

任选一条，期望 top 1 精准：
- [ ] `/help pod crashloop 根因` → 期望 `cluster.describe` / `cluster.pod.events`
- [ ] `/help 扩容一个 deploy` → 期望 `cluster.scale`
- [ ] `/help 查安全组规则` → 期望 `infra.aws.sg.rules`
- [ ] `/help 回滚 deploy` → 期望 `app.rollback`
- [ ] `/help 最近一小时 ec2 cpu` → 期望 `infra.aws.vm.metrics` / `dashboard`
- 问题：

### 5.3 LLM 开启时（如果 sandbox 有 `GEMINI_API_KEY`）

- [ ] Context Bar 打开 LLM toggle
- [ ] 重跑 5.1 的同一个问题
- [ ] **期望**：`summary` 是 Gemini 写的自然语言回答，不是 "Top picks for…"
- [ ] `suggested_commands` 只包含真实 catalog 里的命令（server 侧白名单已过滤幻觉）
- 问题：

---

## 六、回归项（既有功能不应破坏）

- [ ] `/cluster scale <deploy> --replicas N --ns <ns> --reason "x"` 审批流四层护栏（preflight → plan → approve → dryrun → apply）依次亮绿
- [ ] `/app deploy <name> --ns <ns> --image <ref> --reason "x"` 两步序列执行，PerStepPanel 正常
- [ ] `/ops audit logs --since 1h` 审计查询仍是 table 视图
- [ ] `/clear` 只清对话视图，`/ops audit logs` 仍能查到历史
- [ ] `/help` 空问题走 catalog tour（"Slash has 53 skills across 5 namespaces..."）
- 问题：

---

## 反馈模板

发现问题请按这样描述，我照单改：

```
[项号]  [期望行为]
实际看到：<截图或描述>
希望改成：<你的建议>
```

例如：
```
[1.3]  顶部 reason 聚合条应该只在 Warning ≥1 时出现
实际：0 Warning 时也有一条空聚合条
希望改成：0 Warning 时完全隐藏顶栏
```
