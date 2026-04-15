# VidGnost TS 全栈重构执行清单

更新时间：2026-04-15
适用分支：`refactor260415`

## 1. 目标定义

VidGnost 当前交付目标是单仓 TS 全栈桌面工作台：

- 前端使用 `React 19 + Vite 6 + Electron 31 + TypeScript 5`
- 后端使用 `Fastify 5 + TypeScript 5`
- 契约层使用 `packages/contracts`
- 本地运行时数据统一写入仓库根目录 `storage/`
- AI 任务链允许调用外部 CLI 与本地模型服务，但业务主链不再依赖 Python 后端

这里的“彻底脱离 Python 后端”指的是：

- 仓库不再保留 `backend/` 作为运行、开发、测试、启动、校验或回滚入口
- 启动脚本、Git Hook、OpenSpec 校验、文档说明全部以 TS/Node 为唯一主线
- 任务编排、配置管理、历史记录、导出、自检、VQA、SSE 均由 `backend-ts` 提供

## 2. 当前项目真实现状

截至 2026-04-15，仓库已经具备以下基础：

- `backend-ts` 已具备可运行的 Fastify 服务骨架与真实业务依赖装配
- 任务链已接入媒体处理、ASR、摘要生成、事件总线、模型目录与配置仓库
- 配置读写已经切到根目录 `storage/`，并修复了 Windows 下小文件覆盖写入问题
- `contracts` 已承载配置、任务、自检、VQA 等共享 schema
- `frontend` 已以 TS 为主，直接消费 `@vidgnost/contracts`

本轮执行前识别出的主要缺口如下，现已全部闭合：

- 根启动链仍指向 Python/uv/Uvicorn
- Git hook、OpenSpec 校验和敏感信息守卫仍存在 Python 版实现
- README、技术栈文档、OpenSpec 仍大量描述 `FastAPI`、`faster-whisper`、`backend/storage`
- 仓库中仍保留完整 `backend/` 目录与 Python 测试资产

## 3. 当前技术栈

| 维度 | 当前技术栈 | 说明 |
| --- | --- | --- |
| Monorepo | `pnpm workspace` | 根工作区统一管理前端、后端、contracts、shared |
| 前端渲染 | `React 19` | 桌面工作台 UI |
| 前端构建 | `Vite 6` | 开发服务器与生产打包 |
| 桌面壳层 | `Electron 31` | 桌面窗口、路径打开、外链打开等宿主能力 |
| 前端样式 | `Tailwind CSS 4`、`Radix UI`、`Lucide React` | 组件与视觉基础设施 |
| 前端状态 | `Zustand 5` | 任务运行态与界面状态 |
| 后端服务 | `Fastify 5` | `backend-ts` 的 HTTP API 与 SSE 宿主 |
| 后端语言 | `TypeScript 5` | 服务逻辑、任务编排、模型配置、自检与导出 |
| 共享契约 | `packages/contracts` + `zod` | 前后端共用请求、响应和领域模型 |
| 日志 | `pino` | 后端结构化日志 |
| 打包工具 | `tsup`、`tsx`、`typescript` | TS 编译、watch 与类型检查 |
| 测试 | `vitest` | 后端与 contracts 测试 |
| 媒体处理 | `ffmpeg`、`ffprobe`、`yt-dlp` | 视频探测、抽音频、来源拉取 |
| ASR 路径 | `whisper.cpp` CLI / OpenAI-compatible ASR fallback | TS 通过外部 CLI 或兼容 API 驱动 |
| LLM 路径 | Ollama / OpenAI-compatible API | 笔记、导图、纠错、问答 |
| 向量与问答 | TS 本地索引目录 + VQA runtime service | 不再依赖 Python sidecar |
| 运行时存储 | `storage/` | 任务记录、工件、事件日志、模型配置 |
| 旧资产 | `backend/`、若干 `.py` 脚本 | 已完成删除 |

## 4. 目标技术栈

| 维度 | 当前状态 | 目标状态 |
| --- | --- | --- |
| 后端语言 | Python + TypeScript 并存 | TypeScript 单栈 |
| API 框架 | FastAPI / Fastify 描述混杂 | Fastify 5 |
| 开发启动 | `uv` + `uvicorn` + `pnpm` | `pnpm` 单入口 |
| 任务编排 | Python 旧链 + TS 新链并存 | `backend-ts` 单实现 |
| 配置校验脚本 | Python | Node `.mjs` |
| Git Hook 守卫 | Python | Node `.mjs` |
| 存储目录 | `backend/storage` 与 `storage/` 并存描述 | `storage/` 单目录 |
| 文档说明 | Python/FastAPI/faster-whisper 旧表述 | TS/Fastify/whisper.cpp 现状表述 |
| 运行时回退 | Python 可回退 | 无 Python 回退通道 |
| 仓库结构 | `backend/` + `backend-ts/` | 仅保留 TS 服务目录 |

## 5. 执行清单

## 5.1 阶段 A：锁定 TS 后端主链

- [x] 完成 `build-app.ts` 真依赖装配，接入真实媒体、ASR、摘要、模型与事件模块
- [x] 让任务编排从模拟执行切换为真实执行链
- [x] 把模型配置、Whisper 运行时配置、任务读写统一落到根目录 `storage/`
- [x] 修复 Windows 下配置写入与任务状态写入的原子覆盖问题
- [x] 补齐 `config`、`self-check`、`task-events`、`task-exports`、`task-mutations`、`vqa` 等 TS 路由
- [x] 补齐 `contracts` 中与 TS 后端已实现能力对应的 schema

## 5.2 阶段 B：切换仓库工具链为 TS-only

- [x] 新增 Node 版 `scripts/check-openspec.mjs`
- [x] 新增 Node 版 `scripts/check-spec-sync.mjs`
- [x] 新增 Node 版 `scripts/sanitize-staged-secrets.mjs`
- [x] 更新 `.githooks/pre-commit`，去除 Python 依赖
- [x] 更新 `scripts/check-openspec.ps1`
- [x] 更新 `scripts/check-openspec.sh`
- [x] 更新根 `package.json`，补充 Node 版校验脚本命令
- [x] 更新工作区清理脚本，去除 Python cache 目标
- [x] 更新 `.gitignore`，收敛到 Node 工作区与根 `storage/`

## 5.3 阶段 C：切换启动链为 TS-only

- [x] 更新 `start-all.ps1`
- [x] 更新 `start-all.sh`
- [x] 更新 `scripts/bootstrap-and-run.ps1`
- [x] 更新 `scripts/bootstrap-and-run.sh`
- [x] 去除 `uv sync`
- [x] 去除 `uv run python -m uvicorn ...`
- [x] 改为 `pnpm install + pnpm --filter @vidgnost/backend-ts dev + pnpm --filter @vidgnost/frontend desktop:dev`
- [x] 启动脚本统一注入 `VIDGNOST_STORAGE_DIR=storage`

## 5.4 阶段 D：同步文档与规范

- [x] 生成新的 TS 全栈重构执行清单
- [x] 重写 `README.md`
- [x] 重写 `README.zh-CN.md`
- [x] 重写 `docs/current-tech-stack.zh-CN.md`
- [x] 重写 `docs/frontend-driven-backend-execution-checklist.zh-CN.md`
- [x] 重写 `docs/backend-api-and-ops-baseline.zh-CN.md`
- [x] 重写 `docs/frontend-backend-field-mapping.zh-CN.md`
- [x] 重写 `docs/vidgnost-task-processing-performance-baseline.zh-CN.md`
- [x] 清理 `docs/vidgnost-python-to-ts-refactor-plan.zh-CN.md`
- [x] 更新 `AGENTS.md` 中的脚本索引与技术栈描述

## 5.5 阶段 E：同步 OpenSpec 到 TS-only

- [x] 更新 `docs/openspec/README.md`
- [x] 更新 `docs/openspec/changes/build-lightweight-v2/proposal.md`
- [x] 更新 `docs/openspec/changes/build-lightweight-v2/design.md`
- [x] 更新 `docs/openspec/changes/build-lightweight-v2/tasks.md`
- [x] 更新 `docs/openspec/specs/llm-runtime-config/spec.md`
- [x] 更新 `docs/openspec/specs/web-workbench-ui/spec.md`
- [x] 更新 `docs/openspec/specs/transcription-pipeline/spec.md`
- [x] 校对 `docs/openspec/specs/history-and-export/spec.md`
- [x] 对应同步 `docs/openspec/changes/build-lightweight-v2/specs/**`

## 5.6 阶段 F：删除 Python 资产

- [x] 删除 `backend/` 目录
- [x] 删除 `scripts/check-openspec.py`
- [x] 删除 `scripts/check_spec_sync.py`
- [x] 删除 `scripts/sanitize_staged_secrets.py`
- [x] 删除 `scripts/self-check-auto-fix.ps1`
- [x] 删除 `scripts/self-check-auto-fix.sh`
- [x] 删除仓库内剩余 `.py` 文件与 Python 专属缓存目录
- [x] 确认仓库文档、脚本与配置不再引用 `backend/`、`FastAPI`、`uvicorn`、`backend/storage`

## 5.7 阶段 G：全量验证与收尾

- [x] 执行 `pnpm typecheck`
- [x] 执行 `pnpm test`
- [x] 执行 `pnpm build`
- [x] 执行 `node scripts/check-openspec.mjs`
- [x] 复查 `git status --short`
- [x] 提交并推送 `refactor260415`

## 6. Python 删除顺序

为了避免删早了导致断链，Python 资产删除顺序固定为：

1. 先完成 Node 版守卫脚本与 Git Hook 切换
2. 再完成启动脚本切换
3. 再把 README、技术栈文档、OpenSpec 切到 TS-only
4. 再删除 Python 脚本
5. 最后删除 `backend/` 整个目录

## 7. 验收标准

以下条件全部满足时，本次重构视为完成：

- 根目录启动脚本能够在无 Python 环境下启动完整桌面开发链
- `frontend` 和 `backend-ts` 的开发、测试、构建均只依赖 Node/pnpm
- `storage/` 成为唯一运行时持久化目录
- 仓库中不再保留任何 Python 后端、Python 脚本与 Python 测试资产
- 文档、README、OpenSpec、Git Hook 与清理脚本均不再引用 Python 后端链路
- `pnpm typecheck`、`pnpm test`、`pnpm build`、`node scripts/check-openspec.mjs` 全部通过
