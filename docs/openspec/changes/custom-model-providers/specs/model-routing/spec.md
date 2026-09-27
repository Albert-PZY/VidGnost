## ADDED Requirements

### Requirement: Providers SHALL be data with an explicit protocol
Status: `implemented`

提供方 SHALL 以数据形式持久化，并显式声明所使用的协议；协议取值限定为
`openai / anthropic / gemini / dashscope / openrouter / local`。
网关 SHALL 按协议选择适配器，不得按提供方 id 做字符串特判。

#### Scenario: Custom provider survives restart
- **WHEN** 用户登记一个自定义提供方后重启服务
- **THEN** 该提供方及其模型仍在设置中，且可继续被角色引用

#### Scenario: Migration from settings v3
- **WHEN** 读取版本为 3 的设置文件
- **THEN** 内置提供方补齐 `protocol`（`openai-compatible` 迁移为 `openai`）与 `builtin: true`，
  用户未登记的提供方不会被凭空创建，文件按 v4 写回

#### Scenario: Gateway dispatch by protocol
- **WHEN** 某角色的路由指向自定义提供方
- **THEN** 网关按该提供方的协议构造请求，不再要求 id 等于 `dashscope`

### Requirement: Users SHALL be able to register custom providers and models
Status: `implemented`

系统 SHALL 允许用户新增、修改、删除自定义提供方，并在提供方下登记模型条目，
字段包含模型 ID、显示名、能力类型，以及可选的上下文长度、向量维度、说明与标签。
自定义模型 SHALL 与内置模型一样进入模型目录、参与角色分配与阶段缓存键。

#### Scenario: Register a provider
- **WHEN** 提交协议、名称、Base URL 与密钥
- **THEN** 提供方出现在模型页的对应域内，密钥只以脱敏尾码对外返回

#### Scenario: Register a model
- **WHEN** 在提供方下登记模型 ID、显示名与能力类型
- **THEN** 该模型出现在目录接口与模型页的能力分组中，并可直接分配角色

#### Scenario: Custom model joins the stage cache key
- **WHEN** 某角色改指向自定义模型
- **THEN** 阶段缓存键随之变化，相关阶段在下次处理时重新执行

### Requirement: Protocols SHALL declare their supported capabilities
Status: `implemented`

每种协议 SHALL 声明它支持的能力集合，取值来自 `chat / vision / embedding / rerank / asr / translation`。
在协议不支持某能力时，登记该能力的模型 SHALL 被拒绝，并返回 `PROTOCOL_CAPABILITY_UNSUPPORTED`
与该协议支持的能力清单。界面 SHALL 在选择能力类型时禁用不受支持的选项。

#### Scenario: Unsupported capability is rejected
- **WHEN** 在 Anthropic 协议下登记一个 `rerank` 模型
- **THEN** 接口返回 `PROTOCOL_CAPABILITY_UNSUPPORTED`，且不写入设置

#### Scenario: Capability list is exposed to the UI
- **WHEN** 前端请求目录接口
- **THEN** 返回每种协议的名称、支持能力、是否支持流式与默认 Base URL

### Requirement: Gateway SHALL route every capability through the protocol layer
Status: `implemented`

对话（含流式）、多模态、向量化、重排、语音转文字与翻译 SHALL 全部经由协议适配器分发，
不得写死到某个提供方客户端。适配器未实现流式时，网关 SHALL 回退为一次性返回整段文本。

#### Scenario: Streaming fallback
- **WHEN** 目标协议没有实现流式接口
- **THEN** 网关改为一次性生成并整段返回，调用方仍能拿到完整答案

#### Scenario: Embedding dimensions
- **WHEN** 向量角色指向自定义模型且登记了 `dimensions`
- **THEN** 请求按该维度发起，并在结果中返回实际维度

### Requirement: Deleting providers or models SHALL be guarded by route usage
Status: `implemented`

当提供方或模型仍被角色路由引用时，删除 SHALL 被拒绝，返回 `PROVIDER_IN_USE` 或 `MODEL_IN_USE`
并列出占用它的角色。内置提供方 SHALL 不可删除，返回 `PROVIDER_BUILTIN`。

#### Scenario: Provider in use
- **WHEN** 删除一个仍承担 `llm.balanced` 的提供方
- **THEN** 返回 `PROVIDER_IN_USE`，并在消息中列出 `llm.balanced`

#### Scenario: Built-in provider
- **WHEN** 删除 `dashscope`
- **THEN** 返回 `PROVIDER_BUILTIN`，提供方保持不变
