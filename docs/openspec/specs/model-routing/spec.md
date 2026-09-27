## Requirements

### Requirement: Pipeline SHALL resolve models by role instead of model name
Status: `implemented`

业务代码 SHALL 只依赖 12 个模型角色：`llm.fast / llm.balanced / llm.reasoning / llm.quality /
llm.bulk / llm.fallback / vision.primary / asr.online / asr.local / embedding / rerank / translate`。

#### Scenario: Role missing from configuration
- **WHEN** 请求一个未配置的角色
- **THEN** 网关抛出 `MODEL_ROLE_MISSING`

#### Scenario: Default routing
- **WHEN** 首次启动且无持久化设置
- **THEN** 使用内置默认路由（百炼为主，`asr.local` 指向本地 `faster-whisper`，`rerank` 指向 OpenRouter）

#### Scenario: Unknown role defaults to persisted baseline
- **WHEN** 持久化设置中缺少某个角色
- **THEN** 该角色回落到内置默认值，而不是留下空路由

### Requirement: System SHALL read credentials from environment variables
Status: `implemented`

提供方密钥 SHALL 优先从内联配置读取，其次读取环境变量（`DASHSCOPE_API_KEY` / `OPENROUTER_API_KEY`），
对外序列化时一律脱敏。

#### Scenario: Credential from environment
- **WHEN** 环境变量存在且未配置内联密钥
- **THEN** `credentialStatus` 为 `{present:true, origin:"env", masked:"sk-…3f9a"}`

#### Scenario: Missing credential
- **WHEN** 既无内联密钥也无环境变量
- **THEN** 调用该提供方时抛出 `PROVIDER_KEY_MISSING`，并提示需要设置的环境变量名

#### Scenario: Inline key reset
- **WHEN** 客户端提交 `apiKey: null`
- **THEN** 提供方改回从环境变量读取

### Requirement: System SHALL disable model thinking for structured tasks when supported
Status: `implemented`

对于结构化抽取类调用，网关 SHALL 尝试携带 `enable_thinking: false`；
当模型拒绝该参数时，SHALL 按模型缓存该结论并重试一次不带参数的请求。

#### Scenario: Model supports the flag
- **WHEN** 模型接受 `enable_thinking:false`
- **THEN** 请求成功且延迟明显下降（实测结构化任务由 6.7s 降到 3.4s）

#### Scenario: Model rejects the flag
- **WHEN** 提供方返回含 `enable_thinking` 的参数错误
- **THEN** 系统把该模型加入不支持集合，立即重试一次不带该参数的请求

#### Scenario: Streaming request
- **WHEN** 流式请求被拒绝且错误信息匹配该参数
- **THEN** 该模型被记录为不支持，后续流式请求不再携带该参数

### Requirement: System SHALL fall back along the role chain on failure
Status: `implemented`

对于 `llm.*` 角色，网关 SHALL 在主路由失败时依次尝试路由链中的兜底模型（默认 `llm.fallback`），
并把每次失败记入日志。

#### Scenario: Primary model fails
- **WHEN** 主路由模型调用抛错且 `allowFallback` 为真
- **THEN** 网关改试兜底模型；全部失败时抛出 `MODEL_CHAIN_FAILED` 并汇总每次失败原因

#### Scenario: Fallback disabled
- **WHEN** 路由的 `allowFallback` 为 false
- **THEN** 只尝试一次，不做兜底

### Requirement: System SHALL expose runtime self-check over real network calls
Status: `implemented`

`GET /api/health/runtime` 与 `POST /api/config/health` SHALL 对所有已启用渠道执行真实调用并返回逐项结果。
检查项由渠道的协议决定：实现的协议走各自的探针（模型清单或上传通道），本地运行时检查 Whisper 模型目录，
未实现探针的协议如实说明跳过。缺少凭据时返回「缺少凭据」而不是发起无效请求。

#### Scenario: Provider healthy
- **WHEN** 密钥有效
- **THEN** 每项检查返回 `ok=true` 与可读的 `detail` 及 `latencyMs`

#### Scenario: Provider unreachable
- **WHEN** 密钥缺失或网络失败
- **THEN** 对应检查返回 `ok=false` 与错误描述，其他提供方检查仍然执行

### Requirement: System SHALL expose a model catalogue for the UI
Status: `implemented`

`GET /api/config/catalog` SHALL 返回可用模型（含 `kind`、`tags`、`free`、`dimensions`、`custom`、推荐角色）、
角色元信息与协议能力表，供前端按「模型类别 → 协议 → 渠道」分组渲染模型卡片并分配角色。
内置目录与用户登记的模型 SHALL 合并为同一份目录。

#### Scenario: Catalogue request
- **WHEN** 前端请求 catalog
- **THEN** 返回内置模型、用户登记的自定义模型、12 个角色说明与 6 条协议能力说明

#### Scenario: Custom model appears in the catalogue
- **WHEN** 用户在某个渠道下登记了模型
- **THEN** 该模型出现在目录中并带 `custom: true`，可直接被角色引用

### Requirement: System SHALL support provider and route updates
Status: `implemented`

`PATCH /api/config/providers` SHALL 支持更新名称、协议、baseUrl、启用状态与内联密钥；
`POST /api/config/providers` 与 `DELETE /api/config/providers/:id` SHALL 支持新增与删除自定义渠道；
`PUT` 与 `DELETE /api/config/providers/:id/models/:modelId` SHALL 支持登记与移除模型；
`PUT /api/config/routes` SHALL 支持整体替换角色路由并做范围校验。

#### Scenario: Update routes
- **WHEN** 客户端提交合法的路由数组
- **THEN** 后端归一化 `temperature`（0-2）与 `maxTokens`（64-200000）后持久化并返回

#### Scenario: Invalid route payload
- **WHEN** 提交的路由缺少 `role` 或 `model`
- **THEN** 后端返回 400 与 `ROUTES_INVALID`

#### Scenario: Provider toggled off
- **WHEN** 某提供方被禁用后仍被角色引用
- **THEN** 调用时抛出 `PROVIDER_DISABLED`

#### Scenario: Credentials are never echoed back
- **WHEN** 任意接口返回提供方列表
- **THEN** `auth` 只包含来源与环境变量名，内联密钥只以 `credentialStatus.masked` 的脱敏尾码出现

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
  用户已登记的提供方按 v4 结构保留并写回

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
- **THEN** 提供方出现在模型页的对应协议下，密钥只以脱敏尾码对外返回

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
与该协议支持的能力清单。界面 SHALL 只在该协议支持的能力类别下提供接入入口。

#### Scenario: Unsupported capability is rejected
- **WHEN** 在 Anthropic 协议下登记一个 `rerank` 模型
- **THEN** 接口返回 400 与 `PROTOCOL_CAPABILITY_UNSUPPORTED`，且不写入设置

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
并列出占用它的角色。内置提供方 SHALL 不可删除，返回 `PROVIDER_BUILTIN`；
删除不存在的模型 SHALL 返回 `MODEL_NOT_FOUND`。切换协议时若已登记的模型不受新协议支持，
SHALL 拒绝并保持原协议。

#### Scenario: Provider in use
- **WHEN** 删除一个仍承担 `llm.balanced` 的提供方
- **THEN** 返回 400 与 `PROVIDER_IN_USE`，并在消息中列出 `llm.balanced`

#### Scenario: Built-in provider
- **WHEN** 删除 `dashscope`
- **THEN** 返回 400 与 `PROVIDER_BUILTIN`，提供方保持不变

#### Scenario: Missing model
- **WHEN** 删除一个并未登记的模型
- **THEN** 返回 404 与 `MODEL_NOT_FOUND`，不把误操作显示成删除成功
