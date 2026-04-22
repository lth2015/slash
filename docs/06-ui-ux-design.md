# 06 · UI/UX 设计（UI/UX Design）

> Slash 是一款**专业 SRE 工具**。UI/UX 目标是 "Linear × Vercel × Raycast" 的融合：精确、克制、现代、可键盘完成。**不做** AI Chat 式的自由输入，也**不做** 夸张装饰。

## 1. 设计语言

### 1.1 基调（Tone）

- **精确 over 友好**：术语准确，不卖萌、不 emoji 充斥（除非是语义图标）。
- **紧凑 over 豪华**：信息密度接近 IDE；不给空白当装饰。
- **键盘优先**：所有操作都能不摸鼠标完成；鼠标是加分项。
- **静态 over 动效**：动效只用于**解释状态变化**（命令解析、审批流转、流式输出），不用于讨好用户。

### 1.2 视觉系统

**主题：Dark 为默认，Light 同等质量。**

调色板（Dark）：

| Token | 值 | 用途 |
| --- | --- | --- |
| `bg/canvas` | `#0B0D10` | 顶层背景 |
| `bg/surface` | `#111418` | 面板 |
| `bg/elevated` | `#171B21` | 悬浮、下拉 |
| `border/subtle` | `#1F242B` | 低层分隔 |
| `border/default` | `#2A313A` | 常规边框 |
| `text/primary` | `#E6EAF0` | 正文 |
| `text/secondary` | `#9BA3AF` | 次要 |
| `text/muted` | `#6B7280` | 提示 |
| `accent/primary` | `#6EA8FE` | 链接、焦点 |
| `accent/ok` | `#5DC48A` | 成功 / read-ok |
| `accent/warn` | `#E6B450` | 警示 |
| `accent/danger` | `#E5484D` | 破坏性 |
| `accent/write` | `#A78BFA` | write 类命令的语义色 |
| `accent/pending` | `#8FA3BF` | 等审批 |

**字体：**
- UI 正文：Inter Variable（系统 fallback：`-apple-system, Segoe UI Variable`）。
- 命令 / 日志 / 代码：JetBrains Mono（fallback：`ui-monospace, SF Mono, Menlo`）。
- 字号阶：12 / 13 / 14 / 15 / 17 / 20 / 24（px）；行高 1.5 为主，命令面板 1.6。

**间距：** 4 / 8 / 12 / 16 / 24 / 32 / 48；圆角 `sm=6 / md=8 / lg=12 / pill=999`；阴影只用于 overlay。

**图标：** Lucide（开源、风格一致）。禁止多 icon 家族混用。

### 1.3 语义色

命令本身按 mode 着色（在 Command Bar 与审计列表里一致）：
- `read` → `text/primary`
- `write` → `accent/write`
- `write + danger` → `accent/danger`（并在左侧画一根细色条）

## 2. 信息架构

```
┌─ Slash ─────────────────────────────────────────────────────────────────────┐
│ Sidebar │                   Main Workspace                       │ Explain  │
│ (240px) │                   (flex)                               │ (360px)  │
│         │                                                         │          │
│ • Home  │  ┌ Command Bar (sticky, ~72px) ────────────────────┐  │          │
│ • Runs  │  │ > /infra aws vm list --region us-east-1         │  │          │
│ • Appr. │  └────────────────────────────────────────────────┘   │          │
│ • Skills│                                                         │          │
│ • Audit │  ┌ Output Panel (tabbed: Result | Plan | Logs) ────┐  │ AI 解释  │
│ • Ops   │  │ ┌──────────────────────────────────────────────┐│  │ diff /   │
│         │  │ │ table / object / log-stream                  ││  │ effects  │
│ ─────── │  │ └──────────────────────────────────────────────┘│  │ (read    │
│ [user]  │  └────────────────────────────────────────────────┘   │  only)   │
└─────────┴─────────────────────────────────────────────────────────┴──────────┘
```

**导航（Sidebar）：**
- Home（最近 runs + 快捷）
- Runs（历史）
- Approvals（审批收件箱，带徽标数）
- Skills（浏览器）
- Audit（审计查询）
- Ops（告警、SLO、报告）

## 3. 关键模块

### 3.1 Command Bar（核心）

技术：CodeMirror 6。

- **占据顶部 sticky**，单行优先，支持 Shift+Enter 进入多行（仅当 Skill 允许 `--file` stdin 等）。
- **token 着色**：namespace（蓝）/ provider（青）/ noun（白）/ verb（紫或红）/ flag（灰）/ value（高亮）/ `@ref`（下划线）。
- **错误下划红波浪线**，hover 显示 ParseError 消息 + 建议；Enter 键无效。
- **补全下拉**：
  - 当前 token 位置 → 候选列表（不模糊匹配，只前缀 + camelCase 缩写）。
  - 每条显示：`token · type · 一行说明`。
  - 远程补全（例如 `--vm <id>`）带 🌐 标记 + 200ms debounce；加载中显示 skeleton。
- **行尾状态徽标**：解析成功 → 绿点 + "parsed"；write 类 → 紫点 + "review needed"；danger → 红点 + "double approval"。
- **快捷键**：
  - `Cmd+K`：打开命令面板（跳转/运行）。
  - `Enter`：提交。read 类立即执行；write 类打开 Plan 面板。
  - `Cmd+Enter`：提交并自动创建审批请求（等同于点 "Request approval"）；**不绕过审批**。对已被策略 `self_approve: true` 标记的 read / low-risk Skill，等同于 `Enter`。
  - `Alt+↑/↓`：历史命令（仅成功解析的）。
  - `Cmd+/`：在 Explain Pane 开/关"解释当前 AST"。

### 3.2 Output Panel（三标签）

- **Result**：按 output schema 渲染（table / object / log / report）。
  - table：header fixed，支持列排序、列宽拖拽、隐藏列、`Cmd+F` 行内搜索、`Cmd+C` 复制选中。
  - object：Key-Value 表 + JSON 预览切换。
  - log：xterm.js，支持 ANSI；右上角 `Follow / Wrap / Copy / Download`。
  - report：Markdown + 内联 table / chart；findings 浮动目录。
- **Plan**：对 write 类自动显示。内容：
  - 命令文本（`read-only` 代码块）。
  - Effects：对每个 target 展示 before/after diff（monaco-diff 风格）。
  - Warnings：列表，每项可展开查看 detail。
  - 操作：`Request approval` · `Save as draft` · `Cancel`。
- **Logs**：跨段合并（parse/plan/preflight/execute）的时间线，带折叠。

### 3.3 Explain Pane（右侧栏，360px）

- 默认折叠。焦点在命令行时可自动展开。
- 内容是**对 AST 的结构化解读**，非自由对话：
  - `What you're about to do`：一句话（模板填充，非 LLM 自由生成）。
  - `Target(s)`：作用对象清单。
  - `Effect kind`：`read / scale / restart / delete / …`
  - `Requires`：approval 数、capability、冻结窗口影响。
  - `Related Skills`：相关命令推荐（来自 Skill registry 的 `see_also`）。
- 底部可选**AI 深度解释**按钮（off by default），点击才调用 LLM，输入严格只传 AST + Skill metadata，不传用户自由文本。

### 3.4 Approvals Inbox

- 列表视图：`Pending / Decided`，列：`Command / Submitter / Age / Risk / Impact`.
- 详情视图：
  - 顶部大字显示**危险等级**（low/medium/high/danger）。
  - Plan diff。
  - 评论线（可 @ 其他审批人）。
  - 操作：`Approve` · `Reject (requires comment)` · `Request changes`。
  - **双审 Skill**：UI 明确显示 "Waiting for 2nd approver"，并防止同一人第二次签字（UI + 后端双校验）。
- 快捷：`A` 批准，`R` 拒绝，`J/K` 上下条目。

### 3.5 Skills Browser

- 左树：按命令坐标浏览（`/infra/aws/vm/…`）。
- 右详情：
  - Manifest 视图（可折叠 yaml）。
  - 参数 schema 表格。
  - Capability 列表。
  - 版本时间线（每次 Git commit 一条）。
  - 测试覆盖率徽标。
  - "Run sample" 按钮 → 填充到 Command Bar。
- 只读；修改走 Git。

### 3.6 Audit Viewer

- 上方 Filter：user / command prefix / time range / state / skill。
- 时间线（virtualized）：一行 = 一个 run；展开看 events（parse/plan/approve/execute/result）。
- 每条 run 可导出 Markdown（与 audit-journal Git 一致）。

### 3.7 Ops Dashboard

- 卡片：`Active Alerts / On-call / SLO / Incidents`.
- `Runbook` 列表可一键打开对应命令；执行仍然走 Approval。

## 4. 交互规范

### 4.1 键盘映射（全局）

| 快捷键 | 动作 |
| --- | --- |
| `Cmd+K` | 命令面板（跳转） |
| `Cmd+L` | 聚焦 Command Bar |
| `Cmd+Enter` | 提交并自动创建审批请求（不绕过审批） |
| `Esc` | 关闭 overlay / 取消补全 |
| `G A` | Approvals |
| `G R` | Runs |
| `G S` | Skills |
| `G D` | Audit |
| `?` | 快捷键速查 |

### 4.2 状态与反馈

- **解析**：<50ms 不显示 spinner；≥50ms 显示 inline skeleton。
- **执行**：顶部 run bar（与 Command Bar 同高）显示当前 run 的阶段：`Parse · Plan · Approval · Preflight · Execute · Done`，每阶段亮起对应小点。
- **错误**：错误不要 alert / toast，而是**原位呈现**：
  - ParseError → 红波浪线 + tooltip。
  - PlanRejected → Plan 面板顶部 banner。
  - ExecutionError → 日志里高亮 + 日志底部的 action："Open trace / Retry (will re-plan) / Open audit"。

### 4.3 空状态

- `No runs yet` → 一行说明 + 三个示例命令（read 类），点击填入 Command Bar。
- `No approvals` → "You're all caught up." 不要插画、不要"表扬"。

### 4.4 加载与流式

- log 流式：新行滑入动效 100ms，follow 模式下自动滚底；用户上滚即暂停 follow，右下角出现 `Jump to latest`。
- 长命令：顶部 run bar 显示耗时与 ETA（若 Skill 声明）。

### 4.5 失败安全

- 网络断线：右上角红点 + "Reconnecting..."；已发出的 run 不会被重复提交（幂等键 = trace_id）。
- 组件崩溃：Error Boundary 不把整屏毁掉；崩溃面板提示 "Copy diagnostic"。

## 5. 可访问性（A11y）

- 对比度：正文 ≥ AA，语义色在 badge 上 ≥ AAA（配对文字 bold）。
- 所有交互元素可 Tab；焦点环 2px `accent/primary`。
- CodeMirror 使用内置 ARIA；下拉项 role=listbox + aria-activedescendant。
- 不把颜色作为唯一信号：mode / risk 也通过 icon + 文案表达。
- 支持系统 `prefers-reduced-motion`：关闭滑入与骨架闪烁。

## 6. 国际化与复制文案

- 界面默认英文（SRE 语境）；`zh-CN` 全量翻译。
- 错误文案遵循 "**What / Why / How**" 三段式：
  - What：一句描述发生了什么。
  - Why：根因（可能）。
  - How：下一步建议（最多 2 条）。
- 拒绝使用 "Oops"、"Something went wrong" 等模糊词；精确到 token / capability / provider。

## 7. 关键页面低保真（ASCII Wireframe）

### 7.1 首屏（已解析 read 命令，展示 table）

```
┌ SLASH ──────────────────────────────────────────────────────── [user ▾] ┐
│ Home        │ > /infra aws vm list --region us-east-1  ✓ parsed        │
│ Runs        │ ─────────────────────────────────────────────────────── │
│ Approvals(3)│  Result   Plan   Logs                                    │
│ Skills      │ ┌──────────┬──────────┬───────┬───────┬───────────────┐│
│ Audit       │ │ Instance │ Name     │ State │ Type  │ Launched      ││
│ Ops         │ ├──────────┼──────────┼───────┼───────┼───────────────┤│
│             │ │ i-0ab..  │ web-1    │ ● run │ m5.lg │ 2 days ago    ││
│             │ │ i-0bc..  │ web-2    │ ● run │ m5.lg │ 2 days ago    ││
│             │ │ i-1xy..  │ worker-3 │ ● stp │ c6.xl │ 1 week ago    ││
│             │ └──────────┴──────────┴───────┴───────┴───────────────┘│
└─────────────┴──────────────────────────────────────────────────────────┘
```

### 7.2 Write 命令 + Plan + Approval

```
┌ SLASH ──────────────────────────────────────────────────────────────────┐
│ > /cluster prod scale web --replicas 10 --ns api --reason "launch"  ✎  │
│   ┃ review needed · 1 approver                                          │
│ ─────────────────────────────────────────────────────────────────────── │
│  Result   [Plan]  Logs                                                  │
│ ┌──────────── Effects (1) ─────────────────────────────────────────────│
│ │  deploy/web @ prod/api                                               │
│ │    replicas:  4  ──▶  10                                             │
│ │    kind:      scale                                                  │
│ │  Warnings: none                                                      │
│ │  Capabilities: k8s.deployment:get, k8s.deployment:scale              │
│ │                                                                       │
│ │  [Request approval]   [Save draft]   [Cancel]                        │
│ └───────────────────────────────────────────────────────────────────── │
└────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Approvals 详情（双审）

```
┌ Approval · /infra aws vm backup restore i-0ab.. --backup b-77 ──── HIGH ┐
│ Submitter: li@…  Age: 2m  Risk: DANGER  Approvers needed: 2/2           │
│ ─────────────────────────────────────────────────────────────────────── │
│  Effects                                                                 │
│    vm i-0ab..   state → restoring from snapshot b-77                    │
│    disk        data will be OVERWRITTEN                                 │
│  Capabilities: aws.ec2:CreateReplaceRoot, ...                           │
│                                                                          │
│  Approvers                                                               │
│    ● alice@…  approved  "looked diff ok"     2025-04-22 11:02           │
│    ○ waiting for 2nd approver                                            │
│                                                                          │
│  [Approve]   [Reject (comment required)]   [Request changes]            │
└────────────────────────────────────────────────────────────────────────┘
```

## 8. 组件清单（实现依赖 shadcn/ui）

| 组件 | 备注 |
| --- | --- |
| CommandBar | 包 CodeMirror 6，暴露 onParse / onExecute |
| Badge | 支持 mode/state 变体 |
| Table（virtualized） | 依赖 @tanstack/react-table + @tanstack/react-virtual |
| DiffView | 内部用 monaco-diff 或 jsdiff 渲染 |
| Inspector | key-value 可复制 |
| LogStream | xterm.js 封装，支持 ANSI |
| ApprovalCard | 带风险变体 |
| FilterBar | 串联查询参数 |
| EmptyState | 标准 W/W/H 文案 |

## 9. 设计验收清单（设计阶段自检）

- [ ] 键盘可完成所有关键流（Command Bar → Plan → Approval → Result）。
- [ ] Dark / Light 所有状态同等质量（截图过评审）。
- [ ] 对比度 / 焦点环 / 屏幕阅读器通过 `audit` skill。
- [ ] 所有语义色配图标/文字，不单独用色。
- [ ] AI 不出现在命令输入路径上；Explain Pane 明显标注 "read-only"。
- [ ] 错误文案 What / Why / How 三段式。
- [ ] 无表情装饰，无无意义动效。
- [ ] 信息密度：首屏可视区展示 ≥ 20 行表格数据，不滚动。
