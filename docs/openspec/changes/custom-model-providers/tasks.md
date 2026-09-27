# 任务：自定义模型接入与协议适配

## 1. 契约

- [x] `ProviderId` 由封闭联合改为字符串，保留四个内置 id 常量
- [x] 新增 `ProviderProtocol`、`ProviderProtocolInfo`（协议能力表）、`CustomModelEntry`
- [x] `ProviderConfig` 增加 `protocol`、`builtin`、`models`；`ModelCatalogEntry.provider` 放宽为字符串
- [x] 新增登记请求类型：`ProviderUpsertRequest`、`ProviderPatchRequest`、`ProviderModelUpsertRequest`

## 2. 协议适配层

- [x] 定义适配器接口：`chat`、`chatStream`、`embed`、`vision`、`rerank`、`transcribe`、`translate`
- [x] `protocols/openai.ts`：对话（含流式）、向量化、多模态、重排、语音转写、翻译
- [x] `protocols/anthropic.ts`：Messages 接口（含流式）与图像块
- [x] `protocols/gemini.ts`：`generateContent` / `streamGenerateContent` 与 `embedContent`
- [x] `protocols/dashscope.ts`：包一层现有 `DashScopeProvider`，补齐接口形状
- [x] `protocols/openrouter.ts`：复用 OpenAI 兼容实现，重排沿用原生端点
- [x] `protocols/local.ts`：包装 `LocalWhisperProvider`，其余能力显式报不支持
- [x] `protocols/index.ts`：协议 → 适配器注册表与能力表

## 3. 网关

- [x] `chat` / `chatStream` 按协议分发，取消 dashscope 特判
- [x] `embed` / `vision` / `translate` / `rerank` / `transcribeOnline` 按协议分发
- [x] 不支持的能力抛出 `PROTOCOL_CAPABILITY_UNSUPPORTED`，消息里带协议名与能力名
- [x] 向量维度优先取自定义模型登记的 `dimensions`
- [x] 未实现流式的协议回退为一次性返回

## 4. 设置仓库

- [x] 持久化升到 v4，并在读取 v3 后写回一次
- [x] 不再按固定 id 列表重建提供方，用户登记的提供方在重载后保留
- [x] 提供方增删改：`createProvider` / `patchProvider` / `deleteProvider`
- [x] 模型增删改：`upsertModel` / `deleteModel`
- [x] 删除前检查角色路由占用，返回 `PROVIDER_IN_USE` / `MODEL_IN_USE`
- [x] 内置提供方拒绝删除（`PROVIDER_BUILTIN`），删除不存在的模型返回 `MODEL_NOT_FOUND`
- [x] 出参不再回传内联密钥，只保留来源与脱敏尾码

## 5. 接口

- [x] `GET /api/config/catalog` 返回协议能力表与自定义模型
- [x] `POST /api/config/providers`、`DELETE /api/config/providers/:id`
- [x] `PUT /api/config/providers/:id/models/:modelId`、`DELETE /api/config/providers/:id/models/:modelId`
- [x] 登记时按协议能力表校验，能力不匹配直接返回 `PROTOCOL_CAPABILITY_UNSUPPORTED`

## 6. 界面

- [x] 模型页改为按「模型类别 → 协议 → 渠道 → 模型」分组，协议按能力过滤
- [x] 「接入渠道」弹窗：名称、协议（由所在分组带入）、Base URL、密钥
- [x] 渠道块提供启用开关、「＋ 模型」与「设置」；自定义渠道的移除在设置弹窗内只确认一次
- [x] 「接入模型」弹窗：模型 ID、显示名、上下文长度，向量化模型再填向量维度
- [x] 自定义模型卡片带「自定义」标记，并提供编辑与移除；被引用时移除禁用并说明原因
- [x] 渠道块与模型卡片默认只读，Base URL 与密钥只在设置弹窗里编辑
- [x] 本地运行时转写参数收进独立弹窗，一次提交

## 7. 验证与文档

- [x] 单测：自定义渠道与模型增删改、协议能力校验、占用与内置保护、v3→v4 迁移、密钥不回传
- [x] 前端单测：分组层级、协议能力过滤、角色分配与占用提示
- [x] `pnpm build`、`pnpm -r typecheck`、`pnpm -r test` 全绿
- [x] 规格：`model-routing` 与 `desktop-studio-ui` 两侧同步，状态推进到 `implemented`
- [x] 守卫：确认 `apps/api/src/providers/` 前缀已覆盖新增的协议适配目录，无需新增映射
- [x] 文档：README 与 `docs/current-tech-stack.zh-CN.md` 同步
