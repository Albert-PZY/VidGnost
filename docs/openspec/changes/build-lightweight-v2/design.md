## Context

VidGnost 当前以 Electron 桌面工作台形态交付：
- 渲染层使用 React + Vite，只负责渲染 TS 后端返回的数据与状态
- `backend-ts` 负责任务编排、模型管理、存储读写、实时事件与数据处理

## Goals / Non-Goals

**Goals**
- 保持前后端边界清晰：前端展示与交互，后端负责能力与数据真值
- 以 Electron 壳层承载工作台体验，标题栏、侧栏、内容区职责明确
- 通过设置中心统一管理模型配置、提示词模板、外观与语言
- 通过稳定的本地存储文件维持可复现配置、任务历史、事件日志与导出产物
- 让模型安装、运行态事件、自检与任务回放都具备明确可观测性

**Non-Goals**
- 当前阶段不引入 SSR 或服务端渲染前端框架
- 当前阶段不设计多租户、远程账户系统或分布式队列

## Decisions

### 1. Host and shell
- Electron 是当前交付宿主。
- 渲染层使用 Vite + React，桌面壳层只暴露窗口控制、打开路径、打开外链等桌面能力。
- 前端数据访问统一走 TS 后端 HTTP API。

### 2. Workbench shell layout
- 顶部标题栏与下方页面滚动区域分离，标题栏保持吸顶可见。

### 3. Settings architecture
- 设置中心包含 `模型配置`、`提示词模板`、`外观设置`、`语言设置` 四个 section。
- 配置弹窗遵循“头尾固定、内容区滚动、尺寸受视口约束”的统一模式。
- 提示词模板使用任务通道级图标区分 `correction`、`notes`、`mindmap`、`vqa`。

### 4. Appearance state
- `ui_settings.json` 持久化 `language`、`font_size`、`auto_save`、`theme_hue`。
- 前端通过 CSS 变量把 `theme_hue` 扩散到标题栏、侧栏、强调色和表面色调。
- 语言切换与外观设置都应在当前会话立即生效，并在重启后恢复。

### 5. Runtime config model
- 在线 LLM 采用 OpenAI 兼容接口模式，配置项持久化到 `storage/model_config.json`。
- 在线 LLM 有效字段包括 `base_url`、`api_key`、`model`、`load_profile`、`local_model_id`、文本纠错参数。
- Whisper 运行时配置持久化到 `storage/config.toml`，保留 `auto|cpu|cuda` 设备策略和 `int8|float32` 精度选项。

### 6. Managed local model workflow
- `/config/models` 负责向前端暴露托管模型目录、安装状态、下载状态和默认路径。
- 本地托管模型下载统一走 TS runtime + CLI / service-manager 链路，并向设置页回传下载进度与取消状态。
- 当前转写运行链路实际准备的是托管 Whisper small 本地缓存。

### 7. Pipeline contract
- 运行链路仍保持 `A -> B -> C -> D` 四阶段模型。
- `D` 阶段固定执行 `transcript_optimize -> fusion_delivery` 子链路。
- SSE 与任务详情共同承担运行态可观测与回放职责。
- `C` 阶段的 Whisper 转写通过独立 worker 进程执行，主进程只负责调度、事件消费和 chunk 级持久化。
- GPU 重计算阶段使用统一的独占执行租约，不再以组件级 LRU 驱逐作为主显存管理策略。

### 8. Brand application
- 项目品牌资源统一使用 `frontend/public/light.svg`。
- Logo 应用到侧栏品牌位与渲染器 favicon，保持桌面工作台识别一致性。

## Risks / Trade-offs

- 当前 Whisper 配置保留 `model_default` 字段，但托管本地缓存仍以 small 模型为当前实现基线。
- 在线生成依赖外部 OpenAI 兼容服务的可用性与配额。
- 主题色完全开放后，需要持续关注不同 hue 下的对比度与可读性。
- 标题栏自绘逻辑需要和窗口状态同步，避免最小化、最大化、关闭行为漂移。

## Delivery Plan

1. 完善设置中心与标题栏相关实现。
2. 持续补齐后端配置、模型管理与任务链路，使前端全部改为真实接口驱动。
3. 保持 OpenSpec、AGENTS 与当前实现同步，避免文档再次失真。
4. 对关键路径执行前端构建、后端编译与 OpenSpec 校验。

## Open Questions

- 未来是否需要把 `model_default=medium` 接入完整的托管下载与运行路径。
- 未来是否需要把主题模式（浅色/深色/系统）也收口进设置中心持久化。
- 未来是否要把更多 Electron 宿主能力收敛到统一的桌面集成层。
