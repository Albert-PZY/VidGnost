# 多模态视频问答链路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. It will decide whether each batch should run in parallel or serial subagent mode and will pass only task-local context to each subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 VidGnost 当前 transcript-only 的视频问答链路扩展为真正的多模态并行链路，支持文本证据与图像证据联合召回、统一重排序和 LLM 组织回答。

**Architecture:** 保留现有 `TaskOrchestrator + RetrievalIndexService + VqaRuntimeService` 主骨架，在 `workflow=vqa` 的阶段 D 内扩展并行子阶段和多模态预热目录；契约层重新引入 `vlm`，运行时新增视频抽帧和视觉模型服务，检索层升级为多路召回 + 融合 + 重排序，前端和 OpenSpec 做最小必要同步。

**Tech Stack:** TypeScript 5, Fastify 5, React 19, Electron 31, Vitest, Zod, ffmpeg/ffprobe, OpenAI-compatible API, Ollama

---

### Task 1: 契约与模型目录扩展

**Files:**
- Modify: `packages/contracts/src/config.ts`
- Modify: `packages/contracts/src/vqa.ts`
- Modify: `packages/contracts/src/tasks.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/modules/models/model-catalog-repository.ts`
- Modify: `apps/api/src/modules/runtime/self-check-service.ts`
- Modify: `apps/desktop/src/lib/types.ts`

- [ ] **Step 1: 为 `vlm` 组件写失败测试或契约断言**

Run: `pnpm --filter @vidgnost/contracts test`
Expected: 当前没有 `vlm` 合同覆盖或相关断言为空

- [ ] **Step 2: 扩展 contracts 允许 `vlm` 和多模态 citation 字段**

修改 `modelComponentTypeSchema`、`vqaCitationItemSchema` 以及相关任务详情扩展字段。

- [ ] **Step 3: 在模型目录中添加 `vlm-default`，并保留旧数据归一化**

`apps/api/src/modules/models/model-catalog-repository.ts` 增加默认视觉模型并兼容旧 catalog 重写逻辑。

- [ ] **Step 4: 为系统自检增加 `视觉模型` 步骤**

自检结果需能列出 `vlm-default` 状态并执行真实探测入口。

- [ ] **Step 5: 运行类型检查**

Run: `pnpm --filter @vidgnost/contracts typecheck`
Expected: PASS

### Task 2: 视频抽帧服务

**Files:**
- Create: `apps/api/src/modules/media/video-frame-service.ts`
- Modify: `apps/api/src/modules/media/media-pipeline-service.ts`
- Modify: `apps/api/src/server/build-app.ts`
- Test: `apps/api/test/vqa.test.ts`

- [ ] **Step 1: 写抽帧服务测试或 fixture 设计**

在 `vqa.test.ts` 中增加预期：多模态任务会生成 frame manifest。

- [ ] **Step 2: 新增 `VideoFrameService`**

使用 `ffmpeg` 按固定时间间隔抽帧，输出图片和 manifest（时间戳、frame index、文件路径）。

- [ ] **Step 3: 将服务注册到应用容器**

在 `build-app.ts` 中实例化并注入给任务编排。

- [ ] **Step 4: 运行后端测试中与抽帧相关的 case**

Run: `pnpm --filter @vidgnost/api test -- vqa.test.ts`
Expected: 至少新增的抽帧断言通过

### Task 3: VLM 推理服务与 OpenAI-compatible 图文接口

**Files:**
- Create: `apps/api/src/modules/vqa/vlm-runtime-service.ts`
- Modify: `apps/api/src/modules/llm/openai-compatible-client.ts`
- Modify: `apps/api/src/modules/runtime/llm-readiness-service.ts`
- Modify: `apps/api/src/modules/runtime/self-check-service.ts`
- Test: `apps/api/test/vqa.test.ts`

- [ ] **Step 1: 先补 VLM 客户端测试桩**

让测试能够模拟图文输入与描述输出。

- [ ] **Step 2: 扩展 OpenAI-compatible 客户端支持图文 message**

新增图文生成接口，用于 VLM 帧语义描述。

- [ ] **Step 3: 新建 `VlmRuntimeService`**

负责单帧/批量帧语义识别，并产出带时间戳的语义描述。

- [ ] **Step 4: 自检支持最小视觉探测**

自检调用 VLM 探测而不是只看静态配置。

- [ ] **Step 5: 运行 VQA 测试**

Run: `pnpm --filter @vidgnost/api test -- vqa.test.ts`
Expected: 图像语义相关 case 通过

### Task 4: 多模态索引、融合与重排序

**Files:**
- Modify: `apps/api/src/modules/vqa/retrieval-index-service.ts`
- Modify: `apps/api/src/modules/vqa/embedding-runtime-service.ts`
- Modify: `apps/api/src/modules/vqa/rerank-runtime-service.ts`
- Modify: `packages/contracts/src/vqa.ts`
- Test: `apps/api/test/vqa.test.ts`

- [ ] **Step 1: 为双证据索引写失败测试**

新增 fixture 断言：索引支持 `transcript` 与 `frame_semantic`。

- [ ] **Step 2: 扩展索引结构**

支持 transcript item、frame semantic item、统一 parse/build。

- [ ] **Step 3: 扩展检索接口**

实现文本召回、图像召回、融合候选和统一重排序。

- [ ] **Step 4: 扩展 trace 输出结构**

trace 中写出文本命中、图像命中、融合命中和最终候选。

- [ ] **Step 5: 跑相关测试**

Run: `pnpm --filter @vidgnost/api test -- vqa.test.ts`
Expected: 多模态检索断言通过

### Task 5: 任务编排与 VQA Runtime 主链路

**Files:**
- Modify: `apps/api/src/modules/tasks/task-orchestrator.ts`
- Modify: `apps/api/src/modules/tasks/task-support.ts`
- Modify: `apps/api/src/modules/tasks/task-repository.ts`
- Modify: `apps/api/src/modules/vqa/vqa-runtime-service.ts`
- Modify: `apps/api/src/routes/vqa.ts`
- Test: `apps/api/test/tasks-write.test.ts`
- Test: `apps/api/test/vqa.test.ts`

- [ ] **Step 1: 先写 VQA 任务阶段失败测试**

断言 `vqa` 任务阶段 D 会包含新增多模态子阶段。

- [ ] **Step 2: 改造阶段 D 编排**

增加 `transcript_vectorize`、`frame_extract`、`frame_semantic`、`frame_vectorize`、`multimodal_index_fusion`。

- [ ] **Step 3: 写出多模态预热目录**

在 `D/vqa-prewarm/` 下输出 transcript index、frames manifest、frame semantic、统一索引清单。

- [ ] **Step 4: VQA runtime 改为真正 LLM 组织回答**

从多模态检索结果构造上下文并调用 LLM 客户端生成回答；保留回退路径。

- [ ] **Step 5: 跑任务与 VQA 测试**

Run: `pnpm --filter @vidgnost/api test -- tasks-write.test.ts vqa.test.ts`
Expected: PASS

### Task 6: 前端工作台、设置中心、文档与 OpenSpec

**Files:**
- Modify: `apps/desktop/src/components/views/task-processing-workbench.tsx`
- Modify: `apps/desktop/src/components/views/settings-view.tsx`
- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `apps/desktop/src/lib/types.ts`
- Modify: `docs/current-tech-stack.zh-CN.md`
- Modify: `docs/openspec/specs/llm-runtime-config/spec.md`
- Modify: `docs/openspec/specs/transcription-pipeline/spec.md`
- Modify: `docs/openspec/specs/llm-summary-mindmap/spec.md`
- Modify: `docs/openspec/specs/web-workbench-ui/spec.md`

- [ ] **Step 1: 更新 VQA 工作台步骤和 Trace 展示预期**

让前端反映真实多模态阶段与检索结构。

- [ ] **Step 2: 设置页增加 `vlm-default` 可视化配置**

样式沿用现有模型卡片和对话框。

- [ ] **Step 3: 更新类型和 API 消费**

保证前端对新增字段编译通过。

- [ ] **Step 4: 同步技术栈和 OpenSpec**

把多模态链路、VLM、自检和工作台行为写入文档。

- [ ] **Step 5: 运行前端类型检查和 OpenSpec 校验**

Run: `pnpm --filter @vidgnost/desktop typecheck`
Expected: PASS

Run: `node scripts/check-openspec.mjs`
Expected: PASS

### Task 7: 统一集成与验证

**Files:**
- Modify: `docs/superpowers/memory/*`
- Modify: 由前 6 个任务产生的冲突文件

- [ ] **Step 1: 集成所有子任务改动**

处理类型、接口、导入导出和 trace 字段冲突。

- [ ] **Step 2: 运行完整后端类型检查**

Run: `pnpm --filter @vidgnost/api typecheck`
Expected: PASS

- [ ] **Step 3: 运行完整后端测试**

Run: `pnpm --filter @vidgnost/api test`
Expected: PASS

- [ ] **Step 4: 运行完整前端类型检查**

Run: `pnpm --filter @vidgnost/desktop typecheck`
Expected: PASS

- [ ] **Step 5: 运行 OpenSpec 校验**

Run: `node scripts/check-openspec.mjs`
Expected: PASS
