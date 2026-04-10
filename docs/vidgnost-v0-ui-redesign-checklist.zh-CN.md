# VidGnost 项目定位与能力清单（V0 UI 重设计输入）

## 1. 文档用途

本清单用于给 V0 重新设计 Electron UI 时作为输入基线，覆盖：

- 项目定位
- 全量功能能力
- 前后端功能映射
- 技术栈与实现边界
- UI 重设计参考信息

---

## 2. 项目定位（Product Positioning）

- 产品类型：本地优先的多模态视频分析软件（Electron）。
- 主要价值：
  - 降低长视频信息提取与复盘成本。
  - 支持运行态可观测（SSE 日志/进度/告警）。
  - 支持历史回放与可复现导出（含字幕与图片证据）。
  - 支持证据驱动的 VQA 与 trace 回放调试。
- 典型用户：
  - 研究/学习场景：从视频中提炼知识结构与关键证据。
  - 内容生产场景：快速生成可编辑笔记、导图和字幕产物。
  - 工程调试场景：检查检索质量、问答链路与运行日志。

---

## 3. 全量功能清单（当前实现）

## 3.1 任务输入与创建

- [x] Bilibili 链接提交任务（`POST /api/tasks/url`）
- [x] 本地视频路径提交任务（`POST /api/tasks/path`）
- [x] 文件上传提交任务（`POST /api/tasks/upload`）
- [x] 前端入口：工作台侧栏“上传视频”弹窗，支持 URL / Path / Upload 三种模式

## 3.2 流水线执行与运行态可观测

- [x] 四阶段主流程：`A -> B -> C -> D`
- [x] D 阶段子流程：`transcript_optimize -> fusion_delivery`
- [x] 任务事件流 SSE（`GET /api/tasks/{task_id}/events`）
- [x] UI 实时显示：
  - 阶段状态与进度条
  - 分阶段日志
  - 运行告警
  - 阶段耗时 / 日志计数
- [x] 任务控制：
  - 取消任务（`POST /api/tasks/{task_id}/cancel`）
  - 重跑 D 阶段（`POST /api/tasks/{task_id}/rerun-stage-d`）

## 3.3 转写与产物编辑

- [x] C 阶段转写结果展示（原始转写 + 分段）
- [x] D 阶段优化转写展示（含实时更新）
- [x] 笔记 Markdown 编辑与预览（终态任务可编辑）
- [x] 导图 Markdown 编辑与预览（终态任务可编辑）
- [x] 产物保存回写（`PATCH /api/tasks/{task_id}/artifacts`）
- [x] 融合提示词预览（Fusion Prompt Preview）

## 3.4 历史任务管理

- [x] 历史列表与搜索（`GET /api/tasks`）
- [x] 任务详情恢复（`GET /api/tasks/{task_id}`）
- [x] 任务标题修改（`PATCH /api/tasks/{task_id}/title`）
- [x] 终态任务删除（`DELETE /api/tasks/{task_id}`）

## 3.5 导出能力

- [x] 支持导出类型（统一接口：`GET /api/tasks/{task_id}/export/{kind}`）：
  - `transcript`
  - `notes`
  - `mindmap`（HTML）
  - `srt`
  - `vtt`
  - `bundle`（`zip/tar`）

## 3.6 配置中心（统一设置页）

- [x] 全局设置入口：顶部齿轮按钮
- [x] 设置页 Tabs：
  - 在线 LLM
  - Faster-Whisper
  - 提示词模板
- [x] LLM 配置（`GET/PUT /api/config/llm`）
- [x] Whisper 配置（`GET/PUT /api/config/whisper`）
- [x] 提示词模板能力：
  - 列表读取（`GET /api/config/prompts`）
  - 生效模板切换（`PUT /api/config/prompts/selection`）
  - 模板创建（`POST /api/config/prompts/templates`）
  - 模板更新（`PATCH /api/config/prompts/templates/{template_id}`）
  - 模板删除（`DELETE /api/config/prompts/templates/{template_id}`）

## 3.7 环境自检

- [x] 启动自检（`POST /api/self-check/start`）
- [x] 自动修复（`POST /api/self-check/{session_id}/auto-fix`）
- [x] 报告查询（`GET /api/self-check/{session_id}/report`）
- [x] 自检 SSE 事件流（`GET /api/self-check/{session_id}/events`）

## 3.8 VQA 工作流

- [x] 检索（`POST /api/search`）
- [x] 非流式问答（`POST /api/chat`）
- [x] 流式问答（`POST /api/chat/stream`）
- [x] 综合分析（检索 + 问答聚合，`POST /api/analyze`）
- [x] Trace 回放（`GET /api/traces/{trace_id}`）
- [x] 前端模式区：
  - `flow`
  - `qa`
  - `debug`
- [x] 前端 VQA 操作按钮：
  - 仅检索
  - 综合分析
  - 流式问答
  - 快速问答
  - 刷新 Trace

## 3.9 多语言与主题

- [x] 中英双语（i18n）
- [x] 亮色/暗色主题切换
- [x] 语言与主题偏好持久化

## 3.10 Mermaid/导图渲染产物

- [x] 笔记中的 Mermaid 图示由后端渲染为 PNG
- [x] Markdown 内使用相对路径引用 `notes-images/*.png`
- [x] 打包导出包含 `notes-images` 目录

---

## 4. 前后端能力映射（用于 UI 信息架构核对）

| 后端能力 | API |
|---|---|
| 任务创建（URL/Path/Upload） | `/api/tasks/url` `/api/tasks/path` `/api/tasks/upload` |
| 任务运行事件流 | `/api/tasks/{id}/events` |
| 任务取消 / D 重跑 | `/api/tasks/{id}/cancel` `/api/tasks/{id}/rerun-stage-d`  |
| 历史查询 / 恢复 | `/api/tasks` `/api/tasks/{id}` |
| 历史改名 / 删除 | `/api/tasks/{id}/title` `/api/tasks/{id}` |
| 产物编辑保存 | `/api/tasks/{id}/artifacts` |
| 单项 / 打包导出 | `/api/tasks/{id}/export/{kind}` |
| LLM 配置 | `/api/config/llm` |
| Whisper 配置 | `/api/config/whisper` |
| Prompt 模板管理 | `/api/config/prompts*` |
| 自检与自动修复 | `/api/self-check/*` |
| VQA 检索 | `/api/search` |
| VQA 问答（流式/非流式） | `/api/chat/stream` `/api/chat` |
| VQA 综合分析 | `/api/analyze` |
| Trace 回放 | `/api/traces/{trace_id}` |

---

## 5. 技术栈清单（Tech Stack）

## 5.1 后端

- 语言与运行时：
  - Python `3.12`
  - FastAPI + Uvicorn
- 依赖管理：
  - `uv`
- 核心库：
  - `faster-whisper`
  - `ffmpeg-python`
  - `yt-dlp`
  - `openai`（OpenAI 兼容调用）
  - `httpx`
  - `orjson`
  - `aiofiles`
  - `python-multipart`
- 关键能力实现：
  - 异步任务执行器（TaskRunner）
  - SSE 事件总线（EventBus）
  - VQA 检索/问答服务与 trace 存储
  - 导出器（文本/字幕/HTML/打包）

## 5.2 前端（Renderer）

- 框架：
  - React `19`
  - TypeScript `5`
  - Vite `8`
- 样式与 UI：
  - Tailwind CSS `3`
  - Radix UI
  - `lucide-react`
  - `react-select`
- Markdown/可视化：
  - `@uiw/react-md-editor`
  - `react-markdown` + `remark-gfm`
  - `markmap-lib` + `markmap-view`
  - `mermaid`
- i18n：
  - `i18next` + `react-i18next`
- 运行态通信：
  - `EventSource`（SSE）
  - `fetch` + ReadableStream（chat stream）

## 5.3 Electron（Desktop Host）

- `electron` `41`
- `electron-vite` `5`
- 进程分层：
  - `main`：窗口管理、后端健康检查、可选后端拉起
  - `preload`：安全桥接（API base / external link）
  - `renderer`：React UI

## 5.4 工程质量与验证

- 前端：
  - ESLint
  - Vitest
  - Playwright（e2e）
- 后端：
  - Pytest
- 规范检查：
  - OpenSpec checker（Python/Shell/PowerShell）

---

## 6. 数据与产物清单（供 UI 设计理解数据边界）

- 配置数据：
  - `backend/storage/model_config.json`
  - `backend/storage/config.toml`
  - `backend/storage/prompts/templates/*.json`
  - `backend/storage/prompts/selection.json`
- 任务数据：
  - `backend/storage/tasks/records/*.json`
  - `backend/storage/tasks/analysis-results/<task_id>/<stage>.json`
  - `backend/storage/tasks/stage-artifacts/<task_id>/<stage>/**`
- 导出相关：
  - `notes-images/**/*.png`
  - `transcript.txt / notes.md / mindmap.md / mindmap.html / subtitles.srt / subtitles.vtt / bundle.zip|tar`
- 可观测日志：
  - `backend/storage/event-logs/<task_id>.jsonl`
  - `backend/storage/event-logs/traces/*.jsonl`
  - `backend/storage/tasks/runtime-warnings/<task_id>.jsonl`

---

## 7. 给 V0 的推荐输入模板（可直接粘贴）

```text
请基于以下产品能力设计 Electron 桌面 UI：
1) 产品定位：本地优先多模态视频分析软件。
目前有两大核心链路：
第一大核心链路（笔记整理输出）：视频输入 -> 自动提取音频，音频按时长切分 -> 音频通过本地 FasterWhisper 转写文本（带时间戳） -> 转写文本通过 LLM 进行纠错优化 -> 转写文本交给 LLM 进行整理输出笔记和思维导图（支持用户进行预览和编辑） -> 用户选择性导出分析产物
第二大核心链路（VQA）：视频输入 -> 自动提取音频，音频按时长切分 -> 音频通过本地 FasterWhisper 转写文本（带时间戳） -> 转写文本通过 LLM 进行纠错优化 -> 转写文本通过本地嵌入模型向量化并入库ChromaDB -> 视频场景切分 + 关键帧采样 -> 本地 VLM 模型对帧画面进行语义识别并通过嵌入模型向量化入库，然后用户通过 LLM 以自然语言进行提问，系统自动根据转写文本和帧画面两种证据进行语义识别，并通过本地 rerank 模型重排序，筛选出相关的视频片段的开始时间点列表，支持用户点击自动跳转到视频对应时间点进行预览
两大核心链路都支持全过程透明化trace追踪
2) 当前信息架构包含：任务输入、设置中心、历史记录、自检。
5) 设置中心现有模块：本地模型配置、提示词模板 CRUD，UI界面字体大小调整、暗亮色切换、中英文切换等。
8) 你可以完全自由地重构布局、视觉风格与交互方式，并根据你的设计判断决定能力呈现方式与优先级。
```
