# 自定义模型接入与协议适配

## 背景

当前模型来源写死在代码里：提供方是 `dashscope`、`openrouter`、`openai-compatible`、`local` 四个固定 id，
模型目录是三个静态数组，网关按 `route.provider === "dashscope"` 这样的字符串判断分发请求。
`openai-compatible` 只有配置项，没有任何客户端实现，因此启用它也不能真正调用；
用户想接自己的模型（自建 vLLM、Ollama、LM Studio、公司内网网关、Anthropic、Gemini 等）没有入口。

## 目标

1. 用户可以在界面上登记自定义提供方（选择协议、填写名称与 Base URL、填写密钥）与自定义模型
   （模型 ID、显示名、能力类型、上下文长度、向量维度）。
2. 自定义模型与内置模型一样进入模型目录、显示在模型页、参与角色分配、参与阶段缓存键。
3. 协议适配覆盖六种：OpenAI 兼容、Anthropic Messages、Google Gemini、DashScope 原生、OpenRouter、本地运行时。
4. 六种模型能力（对话、多模态、向量化、重排、语音转文字、翻译）都允许由自定义模型承担；
   协议不支持的能力在登记时就提示，而不是等到流水线跑起来才失败。

## 非目标

- 不做模型自动发现（拉取 `/v1/models` 填目录）之外的能力探测；本次只做显式登记。
- 不做账号体系与多租户隔离；密钥仍只存在本机 `storage/config/settings.json` 或环境变量。
- 不改动 `apps/api/python` 下的本地 faster-whisper worker。

## 影响

- 契约：`ProviderId` 从封闭联合改为字符串；新增 `ProviderProtocol`、`CustomModelEntry`、协议能力表与登记请求类型。
- 后端：新增协议适配层；网关按协议分发；设置仓库升到 v4 并保留用户登记的提供方。
- 接口：新增提供方与模型的增删改接口，目录接口返回协议能力表。
- 界面：模型页支持添加提供方与添加模型，并显示协议支持的能力范围。
- 规格：`model-routing` 与 `desktop-studio-ui` 两个能力目录。
