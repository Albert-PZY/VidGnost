## ADDED Requirements

### Requirement: Desktop app SHALL expose four workspaces
Status: `implemented`

应用 SHALL 提供资产库、工作台、模型、设置四个工作区，并通过左侧图标导航轨切换；
未打开任务时工作台不可进入。

#### Scenario: Default workspace
- **WHEN** 应用启动
- **THEN** 默认进入资产库，并同时拉取任务列表与模型配置

#### Scenario: Studio requires an open task
- **WHEN** 没有打开任何任务
- **THEN** 工作台导航项禁用并提示「先打开一个任务」

#### Scenario: Backend unavailable
- **WHEN** 健康检查失败
- **THEN** 应用显示阻塞性提示，包含启动命令 `pnpm --filter @vidgnost/api start` 与失败原因，而不是渲染空界面

### Requirement: Command palette SHALL be keyboard-first
Status: `implemented`

`Ctrl/Cmd + K` SHALL 打开命令面板，支持搜索任务、跳转工作区与执行命令；
`↑↓` 选择、`Enter` 执行、`Esc` 关闭。

#### Scenario: Open and navigate
- **WHEN** 按下 Ctrl/Cmd + K 后输入关键字
- **THEN** 结果同时包含匹配的命令与任务，第一项默认选中

#### Scenario: Execute a task entry
- **WHEN** 在面板中回车选中某个任务
- **THEN** 打开该任务并进入工作台，面板关闭

#### Scenario: Dismiss
- **WHEN** 按 Esc 或点击遮罩
- **THEN** 面板关闭且不执行任何动作

### Requirement: Library SHALL distinguish empty, filtered-empty and loading states
Status: `implemented`

资产库 SHALL 区分首次加载、空集合、过滤后为空三种状态，并给出不同的可操作提示。

#### Scenario: Loading
- **WHEN** 首次拉取列表
- **THEN** 显示加载指示，不显示空态

#### Scenario: No tasks at all
- **WHEN** 列表为空且没有搜索条件
- **THEN** 显示产品说明与「新建任务」主操作

#### Scenario: Search matches nothing
- **WHEN** 列表为空但存在搜索条件
- **THEN** 显示「没有匹配 X 的任务」与清除搜索条件的操作

### Requirement: New task dialog SHALL accept paths and links in one input
Status: `implemented`

新建任务弹窗 SHALL 用一个来源输入承接本地路径与远程链接，
并提供预设、语言、转写引擎、画面理解与转写校对选项，`Ctrl/⌘ + Enter` 可直接提交。

#### Scenario: Pick a local file
- **WHEN** 桌面环境下点击「选择本地文件」
- **THEN** 调用 Electron 原生对话框并把绝对路径填入来源输入

#### Scenario: Submit without source
- **WHEN** 来源为空时提交
- **THEN** 显示内联错误提示，不发起请求

#### Scenario: Submission fails
- **WHEN** 后端返回错误
- **THEN** 弹窗保持打开并保留已填内容，同时展示错误信息

### Requirement: Studio SHALL present structure, content and copilot side by side
Status: `implemented`

工作台 SHALL 由章节轨、内容舞台与 Copilot 三栏组成，并在底部提供常驻播放条。

#### Scenario: Chapter rail
- **WHEN** 章节结构已生成
- **THEN** 章节轨列出标题与时间码，并在播放时自动高亮、滚动到当前章节

#### Scenario: Content tabs
- **WHEN** 任务已有对应产物
- **THEN** 笔记、原文、导图、概念页签可用；没有关键帧时画面页签禁用

#### Scenario: Video band
- **WHEN** 来源包含视频轨且画面未收起
- **THEN** 内容区顶部显示 16:9 视频舞台与跟随播放位置的当前章节上下文

#### Scenario: Processing strip
- **WHEN** 任务仍在处理但已产出部分内容
- **THEN** 顶部显示常驻状态条（当前阶段、进度、就绪度），可展开为完整阶段看板

#### Scenario: No content yet
- **WHEN** 任务处理中且尚无转写产物
- **THEN** 直接展示完整阶段看板

### Requirement: Every insight SHALL be seekable from the UI
Status: `implemented`

摘要结论、章节标题、原文行、导图节点、知识概念与问答引用 SHALL 共用同一个播放定位实现，
点击后播放器跳到对应时间并高亮原文。

#### Scenario: Click a citation chip
- **WHEN** 点击答案中的时间码 chip
- **THEN** 播放器 seek 到该时间并开始播放

#### Scenario: Click a transcript line
- **WHEN** 点击原文某行的时间码
- **THEN** 播放器 seek 到该句起点，且该行在播放时保持高亮

#### Scenario: Timeline chapter segments
- **WHEN** 点击播放条上的章节分段
- **THEN** 播放器跳到该章节起点

### Requirement: Mind map SHALL offer a graph view and an equivalent outline view
Status: `implemented`

导图页签 SHALL 同时提供图形与层级两种等价呈现；图形按自然尺寸渲染并由容器滚动，
缩放模式可在「适应宽度」与「100%」之间切换；层级视图的每个节点可携带时间锚点。

#### Scenario: Graph view
- **WHEN** 导图产物存在
- **THEN** 图形视图渲染 Mermaid `mindmap`，初始视口对准根节点，并提供缩放切换

#### Scenario: Outline view
- **WHEN** 切换到层级视图
- **THEN** 以缩进列表呈现同一棵树，带 `start` 的节点显示可点击时间码

#### Scenario: Graph rendering fails
- **WHEN** Mermaid 渲染抛出异常（例如配色格式不被支持）
- **THEN** 展示失败原因与源码，内容不丢失

### Requirement: Transcript pane SHALL support in-text search
Status: `implemented`

原文页 SHALL 支持按关键字过滤句子，过滤时显示命中数与总数，且不改变播放位置。

#### Scenario: Search with matches
- **WHEN** 输入关键字
- **THEN** 只显示包含关键字的句子，并显示「命中 / 总数」

#### Scenario: Search with no matches
- **WHEN** 关键字无命中
- **THEN** 显示明确的空态文案而不是空白区域

### Requirement: Notifications and states SHALL not use colour alone
Status: `implemented`

状态区分 SHALL 同时使用图标与文字，颜色只作为辅助；主要文本对比度不低于 4.5:1；
所有动效遵守 `prefers-reduced-motion`。

#### Scenario: Task status in library
- **WHEN** 卡片展示任务状态
- **THEN** 同时渲染状态图标与中文状态文案

#### Scenario: Reduced motion
- **WHEN** 系统开启减少动效
- **THEN** 入场动画、脉冲与流式光标动画被关闭
