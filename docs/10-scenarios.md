# 10 · 场景（Scenario）规范

> 场景 = 一段**人读**的推荐执行序列。是 SRE runbook 的数字化形态。
>
> 场景**不自动执行任何命令**。每一步都要求用户手动复制到 CommandBar 再按 Enter——这是 harness 安全原则的贯彻，不是疏忽。

## 1. 边界

场景能做什么：
- ✅ 用 Markdown 讲清楚：什么时候用、目标、按什么顺序跑哪几条命令
- ✅ 每条命令以 "Copy to bar" chip 渲染，点击 → CommandBar 填入 + focus
- ✅ 根据命令结果的 findings 给出"下一步往哪走"的分支建议
- ✅ 在 UI drawer 里侧栏可选

场景**不能**做什么：
- ❌ 自动执行任何命令（哪怕是 read）
- ❌ 基于前一条的 output 动态生成下一条（无运行时逻辑）
- ❌ 调用未注册的 skill 或 capability（server 白名单过滤）
- ❌ 传递 session 级状态（每次走场景都是从零开始）

一句话：**场景是聪明的 markdown 模板，不是脚本引擎。**

## 2. 文件格式

```
scenarios/<kebab-case-id>.md
```

### 2.1 Frontmatter

```yaml
---
id: qa-daily-check                # 与文件名对应；UI 和 audit 里都用它
title: QA 集群日常巡检
estimated_minutes: 3
requires_pins: [k8s, aws]         # 列出执行需要的 pin kind
verified_against: v0.7            # 场景引用的 skill/capability 最后一次对齐的版本
severity_bias: routine            # routine | investigation | incident —— 影响 UI 侧栏排序
tags: [daily, k8s, aws]
---
```

所有字段必填（除 `tags`）。frontmatter 解析由 server 处理：校验 `requires_pins` 里的 kind 合法、`verified_against` 格式合法、引用的 skill/capability 全部存在。启动时任一校验失败 → `startup error`（和 skill 一致）。

### 2.2 Body

Markdown 主体按 `## 步骤`、`## 结论模板`、`## 进阶建议` 小节组织（字面 string，parser 识别 `##` + 关键词开启特殊渲染）。示例：

```markdown
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
   /infra aws orphan scan --region us-east-1
   ```

## 结论模板
- ✅ 正常：pending/crash 为 0、warning events < 5、orphan 资源 0
- ⚠ 警告：crash ≥ 1 或 warning ≥ 10 —— 触发 `qa-cleanup` 场景
- ❌ 异常：nodes NotReady ≥ 1 —— 升级到 oncall

## 进阶建议
- 若连续 3 天同一 pod 出现在 crashloop 里，走 `/ops diagnose <service>`。
- 若孤儿 EBS 数量暴增，看最近的 `/infra aws vm ...` 删除审计。
```

### 2.3 命令块识别

```` ``` ```` 的 code fence 块（不指定语言或 `bash` / `slash`）的每一行，如果以 `/` 开头，被 UI 识别为可点击的 chip。其他行（注释等）保留为文本。

不允许 inline code（`` ` `` backtick）作为命令——防止 UX 混淆（"这是命令还是参考？"）。Lint 规则：frontmatter 校验阶段检查每个 `/xxx` 命令的 `namespace + verb` 在 registry 里存在。

## 3. 加载

新模块 `apps/api/slash_api/scenario/loader.py`：
- 启动时扫 `scenarios/*.md`，parse frontmatter + 提取命令块。
- 命令白名单校验：每行 `/xxx ...` 的 `namespace + verb` 前缀必须在当前 skill + capability registry 里存在。
- 暴露 `GET /scenarios` 端点返回 `{scenarios: [{id, title, estimated_minutes, requires_pins, ...}]}` 列表。
- 暴露 `GET /scenarios/{id}` 返回完整 markdown + parsed-commands 数组 + frontmatter。

## 4. UI

### 4.1 侧栏入口

顶栏 "Recent" 按钮旁新增 "Scenarios" 按钮（同级，左右排列）。点击 → 从右侧滑入的 Sheet，宽度约 480px，上部 list：

```
┌ SCENARIOS ──────────────── ✕ ┐
│                                │
│  ◎ QA 集群日常巡检              │
│    daily · 3 min · k8s · aws   │
│                                │
│  ◎ 流水线失败分诊              │
│    investigation · 5 min       │
│                                │
│  ◎ 资源孤儿清理                │
│    routine · 8 min · aws       │
│                                │
└──────────────────────────────┘
```

### 4.2 场景详情视图

点一个场景 → 从右边再滑入一层更宽的 Drawer（约 640px），正文渲染完整 Markdown：

- `##` 段落标题加粗
- 命令块渲染为垂直堆叠的 chip 组，每条 chip 右侧有"复制到命令栏"图标（`→` 箭头）；点击 → 关闭 drawer + 填入 CommandBar + focus
- 常规 Markdown（列表 / 粗体 / 链接）走已有的 Tailwind typography
- 顶部 sticky：标题 + 预计时长 + 所需 pin（与当前 pin 状态对比，未 pin 的 kind 用橙色警告高亮）

### 4.3 命令块 chip 样式

```
┌──────────────────────────────────────────┐
│ /cluster inspect --ns api          →     │ ← hover 高亮；点击填 bar
└──────────────────────────────────────────┘
```

- 暗背景 `bg-surface-sub`
- 灰色 `text-text-secondary`，hover 变 `text-brand`
- 右侧 `ArrowRight` 图标（`lucide-react`）
- **永不自动执行**——和 /help 的 suggested_commands 一致

### 4.4 空态 + 错误

- `GET /scenarios` 返回空 → 侧栏显示 "No scenarios yet. Author one in `scenarios/` to see it here."
- 某个场景 frontmatter 验证失败 → 启动时 fail loud，UI 不展示破损场景。

## 5. 与 /help 的关系

- `/help 做个 QA 巡检` 也应该把相关场景推荐出来。M3 里扩展 `/help` 的关键词匹配，让场景 title/description 进入 haystack。
- 场景推出后仍然只是"引导"；真正的执行还是回到 CommandBar 里一条条跑。

## 6. Audit

场景本身**没有** audit 条目（它不执行）。唯一侧信号：每次用户点"Copy to bar"，前端可以发一个 `POST /scenarios/track`（optional、默认关）记录"X scenario step Y 被复制"——方便后面统计哪个场景最常用。v0.7 先不做，加到 backlog。

## 7. 非目标

- 场景不能表达"基于上一条 output 选下一条"（那是 agent orchestration，另外做）
- 场景不能携带变量 / 配置 / 模板参数（放 frontmatter 里也不做；命令块就是字面字符串）
- 场景不支持多语言切换（全中文或全英文，看作者）
- 不支持场景嵌套
- 不支持前端在线编辑场景（只能在 repo 里改 md）

## 8. 首批交付（M3）

| ID | 对应能力 | 适用 |
|---|---|---|
| `qa-daily-check` | cluster.inspect × 2 + infra.aws.orphan_scan | 每日巡检 |
| `pipeline-triage` | pipeline.recent_failures → 手工跟进 | 修流水线 |

每个场景 Markdown ≤ 120 行。先写死两个；后续能力加进来再增。

## 9. 演进路径（非本版本）

未来（非 v0.7，只是记账）：
- 场景级的 "Run all read steps in background"（保持 read-only 自动化）
- 场景 editor in UI（需要 md preview + schema 校验）
- 场景触发其他场景（"如果 finding X 出现，推荐场景 Y"）
- 场景的使用统计 / 成功率分析

这些都**不在 v0.7 范围内**。
