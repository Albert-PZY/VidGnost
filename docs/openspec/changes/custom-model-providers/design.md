# 设计：协议适配与自定义模型

## 1. 分层

```text
routes/config.ts            提供方与模型的增删改接口
        │
providers/settings-store.ts 持久化（v4）：提供方（含协议、模型清单）与角色路由
        │
providers/gateway.ts        按协议取适配器，统一处理密钥、超时、重试、兜底、用量统计
        │
providers/protocols/*.ts    六种协议的请求构造与响应解析
```

网关不再出现 `route.provider === "dashscope"` 这类判断。它按 `provider.protocol` 取适配器，
再调用适配器上与能力同名的方法；适配器未实现该方法时，网关抛出带协议名与能力名的错误。

## 2. 协议能力表

| 协议 | 对话 | 多模态 | 向量化 | 重排 | 语音转文字 | 翻译 |
| --- | --- | --- | --- | --- | --- | --- |
| `openai` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `anthropic` | ✓ | ✓ | — | — | — | ✓ |
| `gemini` | ✓ | ✓ | ✓ | — | — | ✓ |
| `dashscope` | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| `openrouter` | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| `local` | — | — | — | — | ✓ | — |

约定：

- 翻译没有独立端点，统一走该协议的对话接口，用固定提示词批量翻译。
- 重排走 OpenAI 兼容的 `/rerank` 端点（Cohere、Jina、OpenRouter、SiliconFlow 采用同一形状）。
- 语音转写走 OpenAI 兼容的 `/audio/transcriptions`（`whisper-1`、`gpt-4o-transcribe` 等）；
  DashScope 仍走原有的文件级异步接口；`local` 走 faster-whisper worker。
- 向量维度优先取自定义模型登记的 `dimensions`；内置模型沿用 `EMBEDDING_DIMENSIONS`。

## 3. 数据模型

```ts
type ProviderProtocol = "openai" | "anthropic" | "gemini" | "dashscope" | "openrouter" | "local"

interface ProviderConfig {
  id: string                 // 内置四个 id 不变；自定义提供方由 label 派生并保证唯一
  label: string
  protocol: ProviderProtocol
  baseUrl: string
  enabled: boolean
  builtin: boolean           // 内置提供方不允许删除
  auth: { source: "env" | "inline" | "none"; envVar?: string; inlineKey?: string }
  models: CustomModelEntry[] // 用户登记的模型
  credentialStatus: { present: boolean; masked: string | null; origin: "env" | "inline" | "missing" }
}

interface CustomModelEntry {
  id: string                 // 发给提供方的模型名
  label: string              // 界面显示名
  kind: ModelKind
  contextWindow?: number
  dimensions?: number        // 仅 embedding 使用
  description?: string
  tags?: string[]
}
```

模型目录 = 内置目录（`dashscope` / `openrouter` / `local`）+ 每个提供方登记的 `models`。
两者在目录接口、模型页分组、角色分配、阶段缓存键中不做区分，只在界面上给自定义模型加一个标记。

## 4. 持久化迁移

`settings.json` 版本从 3 升到 4：

- v3 的提供方记录补上 `protocol`：`dashscope → dashscope`、`openrouter → openrouter`、
  `openai-compatible → openai`、`local → local`；同时补 `builtin: true`、`models: []`。
- v4 起不再按固定 id 列表重建提供方数组，用户登记的提供方在重新加载后保留。
- 读取 v3 文件后立即按 v4 结构写回一次，避免后续每次加载都要迁移。

## 5. 校验与错误

| 场景 | 处理 |
| --- | --- |
| 协议不支持某能力 | 登记模型时即拒绝，返回 `PROTOCOL_CAPABILITY_UNSUPPORTED`，并列出该协议支持的能力 |
| 提供方被角色路由引用 | 删除时拒绝，返回 `PROVIDER_IN_USE`，并列出占用的角色 |
| 模型被角色路由引用 | 删除时拒绝，返回 `MODEL_IN_USE`，并列出占用的角色 |
| 内置提供方 | 删除时拒绝，返回 `PROVIDER_BUILTIN`；Base URL、密钥、启用状态仍可修改 |
| 自定义提供方缺密钥 | 允许保存，自检与调用时报 `PROVIDER_KEY_MISSING` |
| 协议不支持流式 | 适配器不实现 `chatStream`；网关回退为一次性返回整段文本 |

## 6. 接口

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/config/catalog` | 追加返回 `protocols`（协议能力表）与自定义模型 |
| `POST /api/config/providers` | 新增自定义提供方 |
| `PATCH /api/config/providers/:id` | 修改名称、Base URL、启用状态、协议与密钥 |
| `DELETE /api/config/providers/:id` | 删除自定义提供方 |
| `PUT /api/config/providers/:id/models/:modelId` | 新增或更新自定义模型 |
| `DELETE /api/config/providers/:id/models/:modelId` | 删除自定义模型 |

沿用 `PATCH /api/config/providers`（批量、按 id 更新内置提供方）以兼容既有界面调用。

## 7. 界面

模型页在现有的「在线模型 / 本地模型 → 提供方 → 能力 → 模型」分组内扩展：

- 页头新增「添加提供方」：选择协议（下拉显示每种协议支持的能力）、填写名称、Base URL、密钥。
- 提供方块头部显示协议名；自定义提供方多一个删除按钮；被角色引用时该按钮禁用并说明原因。
- 提供方块内新增「添加模型」：填写模型 ID、显示名、能力类型、上下文长度（向量模型再填维度）。
- 自定义模型卡片带「自定义」标记，其余行为与内置模型一致：可直接分配角色。

## 8. 影响面

- 契约：`packages/contracts/src/providers.ts`。
- 后端：`apps/api/src/providers/**`、`apps/api/src/routes/config.ts`。
- 界面：`apps/desktop/src/components/views/providers-view.tsx`、`apps/desktop/src/lib/model-groups.ts`、
  `apps/desktop/src/lib/api.ts`、`apps/desktop/src/stores/app-store.ts`。
- 规格与守卫：`scripts/check-spec-sync.mjs` 的 `model-routing` 与 `desktop-studio-ui` 前缀
  需要补上新增的协议适配目录。
