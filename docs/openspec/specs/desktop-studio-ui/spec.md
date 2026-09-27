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

#### Scenario: Chrome keeps the ambient tint
- **WHEN** 两种模式渲染标题栏与导航轨
- **THEN** 这两处使用带透明度的画布底色（标题栏另加背景模糊），环境光晕能透出来；
  图标与文字的对比度仍由语义令牌保证，不因透出的背景而失守

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

### Requirement: Model workspace SHALL organise models by category, then protocol, then channel
Status: `implemented`

「模型」工作区 SHALL 先按模型类别分组（对话 / 多模态 / 向量化 / 重排序 / 语音转文字 / 翻译），
每个类别下再按协议列出已接入的渠道，渠道下列出该类别下的模型。
协议 SHALL 只出现在它支持的能力类别下，能力范围由目录接口的协议能力表决定。

#### Scenario: Categories come first
- **WHEN** 打开模型工作区
- **THEN** 依次渲染六个类别，每个类别显示模型数量与一句话用途说明

#### Scenario: Credentials live with the channel
- **WHEN** 渲染某个渠道
- **THEN** 渠道头部显示凭据状态（脱敏尾码或「缺少密钥」）、Base URL、该类别下的模型数量、启用开关、
  「＋ 模型」与「设置」；Base URL 与密钥只在「设置」弹窗里编辑

#### Scenario: Local runtime has no credential
- **WHEN** 渲染本地运行时渠道
- **THEN** 显示「无需密钥」，转写参数收进「转写参数」弹窗，一次提交

#### Scenario: Protocol filtered by capability
- **WHEN** 某协议不支持某个类别
- **THEN** 该协议不出现在这个类别下（例如 Anthropic 不出现在向量化与重排序类别下）

#### Scenario: Self-check results attach to their channel
- **WHEN** 运行过运行时自检
- **THEN** 每个渠道的检查项显示在该渠道块内，且同一渠道只显示一次，而不是单独一张表

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

### Requirement: Model workspace SHALL allow registering channels and models
Status: `implemented`

「模型」工作区 SHALL 提供两个按需打开的入口：接入渠道（名称、协议、Base URL、密钥）与
在渠道下接入模型（模型 ID、显示名、上下文长度，向量化模型再填向量维度）。
能力类型 SHALL 由所在类别带入，不再让用户重选；模型 ID 在编辑时 SHALL 只读。
提交失败 SHALL 保留已填内容并在弹窗内说明原因。

#### Scenario: Add a channel
- **WHEN** 在某个协议分组下点击「接入渠道」并填写名称
- **THEN** 协议已带入为点击位置对应的协议，Base URL 预填该协议默认值，提交后渠道出现在该类别下

#### Scenario: Add a model
- **WHEN** 在渠道下点击「＋ 模型」并填写模型 ID
- **THEN** 模型登记在渠道下，并立即出现在目录与角色分配候选里

#### Scenario: Embedding dimension
- **WHEN** 在向量化类别下接入模型
- **THEN** 表单出现向量维度字段；其他类别下不出现该字段

### Requirement: Collection SHALL stay read-only until the user edits
Status: `implemented`

渠道块与模型卡片默认 SHALL 只展示状态：协议分组、渠道名称、凭据状态、Base URL 与模型数量；
Base URL 与密钥等表单控件 SHALL 只在用户打开「设置」后出现。
本地运行时的转写参数 SHALL 收进独立弹窗，一次提交，不再逐字段保存。

#### Scenario: Reading the list
- **WHEN** 用户只是浏览模型页
- **THEN** 页面上没有输入框，只有状态与按需打开的入口

#### Scenario: Editing a channel
- **WHEN** 点击渠道的「设置」
- **THEN** 打开弹窗，可改名、改协议、改 Base URL、替换或清除密钥、启用停用

#### Scenario: Local runtime parameters
- **WHEN** 点击本地渠道的「转写参数」
- **THEN** 打开一个包含五项参数的弹窗，保存时一次提交

### Requirement: Custom models SHALL be marked and behave like built-in models
Status: `implemented`

自定义模型卡片 SHALL 带「自定义」标记，并额外提供「编辑」与「移除」入口；
内置模型不显示这两个入口。自定义模型其余行为与内置模型一致：显示能力与承担的角色、
提供「分配角色」选择器、参与角色唯一性约束。
当模型仍被角色引用时，移除入口 SHALL 禁用并说明被哪些角色占用。

#### Scenario: Recognise a custom model
- **WHEN** 浏览模型卡片
- **THEN** 自定义模型带有「自定义」标记，内置模型没有

#### Scenario: Assign a role to a custom model
- **WHEN** 把某个角色分配给自定义模型
- **THEN** 该角色转移到该模型，原承担者的卡片上不再显示该角色

#### Scenario: Blocked removal
- **WHEN** 该模型仍承担某个角色
- **THEN** 移除入口禁用，并说明占用它的角色名称

### Requirement: Provider blocks SHALL expose protocol and lifecycle actions
Status: `implemented`

渠道块头部 SHALL 显示协议所在的分组、凭据状态与 Base URL；SHALL 提供启用开关、
「＋ 模型」与「设置」三个动作。自定义渠道的移除入口 SHALL 位于设置弹窗内并只确认一次；
被角色引用时 SHALL 拒绝并说明占用的角色。

#### Scenario: Delete a custom provider
- **WHEN** 该渠道未被任何角色引用，在设置弹窗中确认移除
- **THEN** 渠道与其模型一并从界面移除

#### Scenario: Blocked deletion
- **WHEN** 该渠道仍承担某个角色
- **THEN** 移除被拒绝，弹窗内说明占用它的角色，渠道保持不变
