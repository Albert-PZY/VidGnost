# VidGnost 项目定位与能力清单（V0 UI 重设计输入）

## 1. 文档用途

本清单用于给 V0 重新设计 Electron UI 时作为输入基线，覆盖：

- 项目定位
- 全量功能能力
- 前后端功能映射
- 技术栈与实现边界
- UI 重设计必须保留的交互语义

---

## 2. 项目定位（Product Positioning）

- 产品类型：本地优先的多模态视频分析工作台（Web + Electron 双形态）。
- 核心目标：把“视频输入 -> 转写 -> 结构化笔记/导图 -> 检索问答 -> 导出复盘”整合为单一工作流。
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
- [x] 前端入口：侧栏“历史记录”弹窗

## 3.5 导出能力

- [x] 支持导出类型（统一接口：`GET /api/tasks/{task_id}/export/{kind}`）：
  - `transcript`
  - `notes`
  - `mindmap`（HTML）
  - `srt`
  - `vtt`
  - `bundle`（`zip/tar`）
- [x] 前端入口：任务完成后右下角导出卡片，支持单项导出 + 全量打包导出

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
- [x] 前端入口：侧栏“环境自检”弹窗 + 时间线日志展示

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

| 后端能力 | API | 当前 GUI 入口 |
|---|---|---|
| 任务创建（URL/Path/Upload） | `/api/tasks/url` `/api/tasks/path` `/api/tasks/upload` | 侧栏“上传视频”弹窗 |
| 任务运行事件流 | `/api/tasks/{id}/events` | 主工作台 runtime 区自动订阅 |
| 任务取消 / D 重跑 | `/api/tasks/{id}/cancel` `/api/tasks/{id}/rerun-stage-d` | runtime 状态条右侧操作按钮 |
| 历史查询 / 恢复 | `/api/tasks` `/api/tasks/{id}` | 侧栏“历史记录” |
| 历史改名 / 删除 | `/api/tasks/{id}/title` `/api/tasks/{id}` | 历史弹窗操作区 |
| 产物编辑保存 | `/api/tasks/{id}/artifacts` | D 阶段编辑区“保存修改” |
| 单项 / 打包导出 | `/api/tasks/{id}/export/{kind}` | 右下角导出卡片 |
| LLM 配置 | `/api/config/llm` | 设置中心 -> 在线 LLM |
| Whisper 配置 | `/api/config/whisper` | 设置中心 -> Faster-Whisper |
| Prompt 模板管理 | `/api/config/prompts*` | 设置中心 -> 提示词模板 |
| 自检与自动修复 | `/api/self-check/*` | 侧栏“环境自检” |
| VQA 检索 | `/api/search` | runtime -> qa/debug |
| VQA 问答（流式/非流式） | `/api/chat/stream` `/api/chat` | runtime -> qa |
| VQA 综合分析 | `/api/analyze` | runtime -> qa |
| Trace 回放 | `/api/traces/{trace_id}` | runtime -> debug |

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
  - Radix UI（Tabs / Switch）
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
- 桌面启动策略：
  - 一键脚本支持 `electron` / `web` 模式
  - 默认使用 `electron` 模式

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

## 7. 给 V0 的 UI 重设计约束（必须保留）

- [ ] 保留三类核心入口：任务输入、运行工作台、设置中心。
- [ ] 保留 runtime 三模式：`flow / qa / debug`。
- [ ] 保留阶段视图语义：`A/B/C/transcript_optimize/D`。
- [ ] 保留终态编辑语义：任务终态后可编辑 notes/mindmap 并保存。
- [ ] 保留导出语义：单项导出 + 打包导出，且只在任务完成后展示。
- [ ] 保留 VQA 全动作入口：检索、综合分析、流式问答、非流式问答、trace 刷新。
- [ ] 保留设置页分栏：在线 LLM、Whisper、提示词模板。
- [ ] 保留历史任务能力：搜索、恢复、改名、删除。
- [ ] 保留环境自检能力：启动、自动修复、事件流。
- [ ] 保留中英双语与主题切换能力。

---

## 8. 给 V0 的推荐输入模板（可直接粘贴）

```text
请基于以下产品能力重新设计 Electron 桌面 UI：
1) 产品定位：本地优先多模态视频分析工作台，核心链路是 视频输入 -> 转写 -> 笔记/导图 -> VQA -> 导出。
2) 必须包含的信息架构：任务输入、运行工作台(flow/qa/debug)、设置中心、历史记录、自检。
3) 运行工作台必须包含阶段视图 A/B/C/transcript_optimize/D，显示状态、进度、日志、耗时。
4) VQA 区必须提供：仅检索、综合分析、流式问答、快速问答、Trace 回放。
5) 设置中心必须分栏：在线 LLM、Faster-Whisper、提示词模板 CRUD。
6) 导出区必须支持：bundle、notes、transcript、mindmap、srt、vtt。
7) 保留中英双语、亮暗主题、可编辑 notes/mindmap（终态任务）。
8) 风格目标：专业、清晰、信息密度可控，适合长时间操作。
```

