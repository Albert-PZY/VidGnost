# VidGnost 多模态视频问答链路设计

## 背景

当前 VidGnost 的视频问答链路仍是 transcript-only 基线：

- 任务编排只在阶段 D 预热 transcript 检索索引
- 检索仅基于转写文本
- 回答组织仍是规则拼接，不是真正的 LLM 生成
- 前端工作台也只展示四个简化步骤，无法体现视频抽帧、VLM 识别和多路召回

这与当前目标不一致。目标链路应当在转写后并行处理文本和图像证据，并在问答阶段进行统一融合检索与重排序。

## 目标

把 `workflow=vqa` 改造成真正的多模态问答链路：

- 文本转写完成后异步进行文本向量化
- 同时执行视频抽帧和 VLM 图像语义识别
- 识别结果结合时间戳再进行向量化
- 检索阶段同时结合文本证据和图像证据进行多路召回
- 融合后的候选进入统一重排序
- 最终将高质量证据交给 LLM 组织回答

## 方案选择

### 方案 A：在现有 transcript-only 链路上保守扩展

优点：

- 与当前代码结构最兼容
- 可保留现有 `TaskOrchestrator`、`RetrievalIndexService`、`VqaRuntimeService` 主体
- UI 样式变更最小

缺点：

- 需要谨慎扩展阶段指标和索引结构
- 要处理旧索引向后兼容

### 方案 B：重写整个 VQA 子系统

优点：

- 边界更干净
- 可一次性建立更理想的数据结构

缺点：

- 影响面过大
- 需要同步重写任务编排、前端工作台、契约、测试、自检和文档

### 方案 C：将多模态作为独立实验链路并行存在

优点：

- 风险隔离较好

缺点：

- 项目中会长期并存两套链路
- 用户需要在 UI 中理解两套行为，维护成本高

## 推荐方案

采用方案 A：在当前链路上保守扩展为多模态并行流水线。

原因：

- 用户已经明确要直接落地，不希望停留在实验态
- 当前代码已有清晰的任务编排、索引、trace 和工作台展示骨架
- 保守扩展可以在最短路径内交付“真正可用的多模态 VQA”，同时避免对 UI 样式做大幅破坏

## 设计

### 1. 任务编排

`workflow=vqa` 在阶段 D 中扩展为以下子阶段：

1. `transcript_optimize`
2. `transcript_vectorize`
3. `frame_extract`
4. `frame_semantic`
5. `frame_vectorize`
6. `multimodal_index_fusion`
7. `fusion_delivery`

其中：

- `transcript_vectorize` 与 `frame_extract` 可以并行启动
- `frame_semantic` 依赖 `frame_extract`
- `frame_vectorize` 依赖 `frame_semantic`
- `multimodal_index_fusion` 依赖两路向量化都完成
- `fusion_delivery` 用于写出最终预热索引与元数据

### 2. 证据模型

索引证据项扩展为统一结构：

- 共有字段：
  - `doc_id`
  - `task_id`
  - `task_title`
  - `source`
  - `source_set`
  - `start`
  - `end`
  - `text`
  - `terms`
  - `vector`
- 图像证据可选字段：
  - `image_path`
  - `visual_text`
  - `frame_index`

文本证据由 transcript segment 和扩窗窗口生成。

图像证据由抽帧结果和 VLM 描述生成。每条图像证据必须带时间戳，确保能与视频时间轴联动。

### 3. 检索链路

检索时执行四步：

1. 文本证据召回
2. 图像证据召回
3. 融合召回结果
4. 统一重排序

融合方式优先使用保守的 weighted merge / RRF 组合，而不是一上来引入复杂 ANN 引擎。当前阶段重点是把链路正确打通，并让 trace 可观测。

### 4. 回答生成

`VqaRuntimeService` 不再直接模板拼接回答，而是：

- 构造包含问题、top evidence、时间戳、来源类型的上下文
- 调用现有 OpenAI-compatible LLM 客户端生成回答
- 输出引用列表与近似上下文 token 数

当 LLM 不可用时，允许保留简短回退回答，但回退必须是例外路径，而不是主路径。

### 5. VLM 与模型管理

模型目录重新引入 `vlm` 组件：

- 合同层允许 `vlm`
- 模型目录添加 `vlm-default`
- 设置页显示 `vlm` 配置
- 自检页增加 `视觉模型` 真实推理探测

VLM 调用优先复用现有 OpenAI-compatible 客户端，扩展图文输入能力，并兼容 Ollama 视觉模型。

### 6. 前端工作台

VQA 工作台步骤从旧四步改为更贴近真实链路的多阶段：

- 音频提取
- 语音转写
- 文本优化
- 文本向量化
- 视频抽帧
- 画面识别
- 问答就绪

Trace Theater 也要扩展，展示：

- 文本召回命中
- 图像召回命中
- 融合候选
- 重排序结果
- LLM 组织回答预览

样式保持现有工作台风格，只增强信息结构，不大改视觉设计。

### 7. 产物与落盘

`D/vqa-prewarm/` 目录扩展为：

- `transcript-index.json`
- `frames.json`
- `frame-semantic.json`
- `multimodal-index.json`
- `index.json`

其中 `index.json` 作为统一入口清单，供运行时优先读取。

### 8. 测试

测试覆盖三类：

- Logic：索引构建、融合和重排序
- API：VQA 路由、任务重跑与预热产物
- UI/Contract：工作台步骤和 trace 数据结构

必须新增至少一组验证“文本与图像证据同时存在”的多模态 fixture。

## 错误处理

- 抽帧失败：允许 VQA 降级为 transcript-only，并记录阶段日志
- VLM 识别失败：允许仅图像链路降级，但仍保留文本问答能力
- 图像向量化失败：允许仅使用文本证据完成检索
- LLM 回答失败：返回可解释的回退回答和 citation，不丢弃检索结果

## 验证策略

- 后端 `typecheck` 和 `vitest`
- 前端 `typecheck`
- OpenSpec 校验
- 自检逻辑验证 `vlm` / `embedding` / `rerank`
- API 级 fixture 验证多模态预热产物、检索响应和 trace 结构
