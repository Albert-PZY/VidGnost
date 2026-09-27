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

### Requirement: Application SHALL support light and dark themes with token parity
Status: `implemented`

同一套语义令牌 SHALL 提供浅色与深色两组取值（`globals.css` 的 `:root` 与 `.dark`），
组件只消费语义令牌；主题可选 `浅色 / 深色 / 跟随系统`，选择持久化在 `localStorage`。

#### Scenario: First paint
- **WHEN** 页面开始加载
- **THEN** 内联脚本在首屏绘制前根据存储值与系统偏好设置 `html` 的 `dark` 类与 `data-theme`，不出现主题闪烁

#### Scenario: Quick toggle
- **WHEN** 点击标题栏的主题按钮
- **THEN** 在浅色与深色之间切换，并把显式模式写入存储

#### Scenario: Follow the system
- **WHEN** 模式为「跟随系统」且系统主题改变
- **THEN** 界面跟随切换，且不覆盖存储中的 `system` 取值

#### Scenario: Explicit mode wins
- **WHEN** 已选择显式浅色或深色
- **THEN** 系统主题变化不改变界面

#### Scenario: Contrast gate
- **WHEN** 运行 `node scripts/check-theme-contrast.mjs`
- **THEN** 两种模式下所有文本与关键控件配对的对比度都达标（正文 4.5:1、图标类 3:1），否则退出码非零

#### Scenario: Chrome stays neutral
- **WHEN** 两种模式渲染标题栏与导航轨
- **THEN** 这两处使用不透明画布底色，环境光晕透不过来，图标颜色不被背景染色

### Requirement: Graphics SHALL follow the active theme
Status: `implemented`

内联图形（思维导图）SHALL 使用与当前主题一致的配色，且不得依赖设计令牌不支持的色彩格式。

#### Scenario: Mermaid colour format
- **WHEN** 渲染 Mermaid 图形
- **THEN** 传入十六进制配色；使用 `oklch()` 会被解析器拒绝并导致渲染失败

#### Scenario: Section tints
- **WHEN** Mermaid 的 `mindmap` 忽略 `cScale*` 并生成自带色阶
- **THEN** 渲染后按主题重写图形内部的 section 填充、描边与文字色，节点保持低饱和且文字对比度达标

#### Scenario: Theme switch while a graph is visible
- **WHEN** 在导图页签下切换主题
- **THEN** 图形用新主题重新渲染

### Requirement: Model workspace SHALL group models by scope, provider and capability
Status: `implemented`

「模型」工作区 SHALL 先按 **在线模型 / 本地模型** 分成两组，组内按提供方分块，
块内再按能力（对话 / 多模态 / 语音转文字 / 向量化 / 翻译 / 重排序）细分到具体模型。

#### Scenario: Two top-level scopes
- **WHEN** 打开模型工作区
- **THEN** 依次渲染「在线模型」与「本地模型」两组，各自显示模型数量与用途说明

#### Scenario: Credentials live with the provider
- **WHEN** 渲染在线提供方
- **THEN** 块头部显示凭据状态（脱敏尾码或「缺少密钥」）、来源环境变量名、启用开关与模型数量，块内可编辑 Base URL、替换密钥

#### Scenario: Local runtime has no credential
- **WHEN** 渲染本地模型
- **THEN** 显示「无需密钥」，并把模型标识、CTranslate2 模型目录、推理设备、计算精度与 Python 可执行文件就地呈现

#### Scenario: Capability subdivision
- **WHEN** 某提供方拥有多种能力的模型
- **THEN** 先出现带固定色点的能力小标题，再列出该能力下的模型

#### Scenario: Provider without registered models
- **WHEN** 提供方已配置但模型目录为空
- **THEN** 该块仍可见（凭据可维护），并说明「未登记可用模型，暂时无法被角色引用」

#### Scenario: Self-check results attach to their provider
- **WHEN** 运行过运行时自检
- **THEN** 每个提供方的检查项显示在该提供方块内，而不是单独一张表

### Requirement: Role assignment SHALL be expressed on the model card
Status: `implemented`

角色 SHALL 在模型卡片上分配：卡片展示该模型当前承担的角色 chip，并提供「＋ 分配角色」选择器，
只列出该模型能力与提供方都支持、且尚未由本模型承担的角色。

#### Scenario: Model serving a role
- **WHEN** 某模型承担了角色
- **THEN** 卡片显示对应角色名的 chip（例如「均衡模型」）

#### Scenario: Model serving nothing
- **WHEN** 某模型未承担任何角色
- **THEN** 卡片显示「未承担任何角色」，不显示空 chip

#### Scenario: Incompatible roles are hidden
- **WHEN** 模型能力为对话
- **THEN** 选择器只列出 `llm.*` 角色，不出现向量化、重排或本地转写

#### Scenario: Local runtime options
- **WHEN** 模型来自本地运行时
- **THEN** 选择器只提供「本地转写」这一个角色

#### Scenario: Moving a role
- **WHEN** 把已由其他模型承担的角色分配给当前模型
- **THEN** 该角色转移到当前模型，原卡片上的 chip 消失，并出现一条「角色 → 模型」的切换提示

#### Scenario: No assignable roles left
- **WHEN** 模型已承担它可承担的全部角色
- **THEN** 不渲染选择器，避免出现必然失败的操作

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
