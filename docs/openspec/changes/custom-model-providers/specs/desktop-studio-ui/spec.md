## ADDED Requirements

### Requirement: Model workspace SHALL organise models by category, then protocol, then channel
Status: `implemented`

「模型」工作区 SHALL 先按模型类别分组（对话、多模态、向量化、重排序、语音转文字、翻译），
每个类别下再按协议列出已接入的渠道，渠道下列出该类别下的模型。
协议 SHALL 只出现在它支持的能力类别下；声明的能力由目录接口的协议能力表决定。
同一渠道 SHALL 出现在它协议支持的每个类别下，以便继续接入该类别的新模型。

#### Scenario: Categories come first
- **WHEN** 打开模型页
- **THEN** 页面按六个类别纵向排列，每个类别标题下是该类别的一句话用途说明

#### Scenario: Protocol is filtered by capability
- **WHEN** 某协议不支持某个类别
- **THEN** 该协议不出现在这个类别下（例如 Anthropic 不出现在向量化与重排序类别下）

#### Scenario: Channel with no model of this category
- **WHEN** 一个已启用的渠道在本类别下没有模型
- **THEN** 该渠道仍然列出，并标明本类别下还没有模型，以便就地补登记

#### Scenario: Empty protocol shows what it fits
- **WHEN** 某协议还没有接入任何渠道
- **THEN** 该协议分组显示一句话说明它适合接入什么，并提供「接入渠道」入口

#### Scenario: Backend is older than the front end
- **WHEN** 目录接口没有返回协议能力表（例如后端进程还跑着旧代码）
- **THEN** 页面显示一句可执行的说明（重启后端后刷新），而不是渲染空壳分组或整页报错
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
