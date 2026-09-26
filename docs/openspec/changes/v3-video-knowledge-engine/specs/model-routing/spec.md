## ADDED Requirements

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

`GET /api/health/runtime` 与 `POST /api/config/health` SHALL 执行真实调用并返回逐项结果：
百炼对话、百炼向量、百炼文件转写通道、OpenRouter 模型列表、本地 Whisper 模型目录。

#### Scenario: Provider healthy
- **WHEN** 密钥有效
- **THEN** 每项检查返回 `ok=true` 与可读的 `detail` 及 `latencyMs`

#### Scenario: Provider unreachable
- **WHEN** 密钥缺失或网络失败
- **THEN** 对应检查返回 `ok=false` 与错误描述，其他提供方检查仍然执行

### Requirement: System SHALL expose a model catalogue for the UI
Status: `implemented`

`GET /api/config/catalog` SHALL 返回可用模型（含 `kind`、`tags`、`free`、推荐角色）
与角色元信息，供前端渲染路由选择。

#### Scenario: Catalogue request
- **WHEN** 前端请求 catalog
- **THEN** 返回百炼 13 个模型、OpenRouter 1 个模型、本地 1 个模型与 12 个角色说明

### Requirement: System SHALL support provider and route updates
Status: `implemented`

`PATCH /api/config/providers` SHALL 支持更新 baseUrl、启用状态与内联密钥；
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
