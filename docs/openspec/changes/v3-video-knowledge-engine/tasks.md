# Tasks — v3 视频知识引擎重构

## 1. 回滚与现状分析

- [x] 将工作区回滚到 `origin/master`（丢弃未提交改动，保留测试素材）
- [x] 梳理旧版模块边界、存储布局与运行时假设，确认需要替换的主干
- [x] 验证在线模型能力：LLM 对话/流式/JSON、多模态图注、文件级异步 ASR、embedding、批量翻译、rerank

## 2. 契约层

- [x] 重写 `packages/contracts`：`common / media / transcript / insight / pipeline / retrieval / providers / requests`
- [x] 用 zod 定义并校验 `createTaskRequest`、`askRequest`、`settingsPatch`、`providerPatch`、`modelRoutes`
- [x] `packages/shared` 收敛为常量索引（应用名、端口、阶段顺序）

## 3. 后端主干

- [x] `core`：配置解析、错误模型、文件工具、ID/指纹、文本工具（时间码、分词、JSON 抽取、预算切分）、进程与下载
- [x] `providers`：模型目录与角色默认路由、设置仓库（密钥解析与脱敏）、HTTP 客户端（超时/重试/并发）、
      DashScope（对话/流式/向量/多模态/翻译/临时上传/异步文件转写）、OpenRouter rerank、本地 faster-whisper、模型网关（角色→路由链+兜底）
- [x] `providers/health`：百炼（对话/向量/文件转写通道）、OpenRouter（rerank）、本地 Whisper 的真实连通性自检
- [x] `media`：来源解析（本地路径/URL/yt-dlp/直链）、ffprobe 探测与指纹、16k 单声道音频抽取与 ASR 分片、关键帧抽取与感知哈希去重
- [x] `asr`：在线分片转写 + 偏移合并、本地 Whisper 兜底、转写标准化与 SRT 输出
- [x] `insight`：语义分段、章节切分（按视频时长定章节数）、章节要点 map、全局 reduce 摘要（含 highlights 回退）、
      思维导图（树 + mermaid）、知识图谱、纠错（带相似度保护）、翻译、逐帧多模态图注（携带前帧上下文）
- [x] `retrieval`：章节绑定切块（含帧图注融合）、BM25（二元组分词）、向量索引（512 维，base64 float32）、
      上下文前缀与问题变体、RRF 融合 + rerank、全局意图路由、流式问答与引用校验
- [x] `pipeline`：阶段定义与就绪度、事件总线（含落盘回放）、10 阶段可续跑 runner（检查点缓存）、任务管理器（并发/取消/删除/重跑/启动恢复）
- [x] `store`：任务仓库、工件索引与读取、事件日志
- [x] `routes`：health / catalog / tasks / media(Range) / SSE 事件流 / ask(SSE) / config / export
- [x] 删除旧模块：`study`、`knowledge-note`、`vqa`、`ollama-*`、`model-catalog`、`bilibili-*`、`platform-subtitle`、`prompt-template`、`translation-decision`、`self-check`、`runtime-metrics` 等
- [x] 旧 package 依赖清理（移除 `jszip`、`qrcode`、`@fastify/multipart`）

## 4. 前端工作台

- [x] 设计系统 v3：石墨黑画布 + 极光微光、发丝描边、三档表面、靛蓝动作色 + 琥珀时间锚点色
- [x] 外壳：frameless 自定义标题栏、图标导航轨、`Ctrl+K` 命令面板（任务跳转 + 命令）
- [x] 资产库：任务卡片（就绪度、标签、规模、状态）、搜索、空态/过滤空态/加载态、删除确认
- [x] 新建任务：路径/链接输入、本地文件选择（Electron 对话框）、预设、语言、引擎、视觉与校对开关
- [x] 工作台：章节轨（跟随播放高亮）、画面带（视频 + 当前章节上下文）、五个内容页签（笔记/原文/导图/概念/画面）、
      Copilot 面板、常驻播放条（章节分段可点击）
- [x] 处理中：常驻状态条 + 完整阶段看板（进度、阶段日志、取消）
- [x] 时间锚点：全局唯一的 `seek` 实现，摘要、原文、导图、引用、章节、播放条共用一个坐标系
- [x] 模型页：「在线模型 / 本地模型」两域 → 提供方 → 能力（对话/多模态/语音转文字/向量化/翻译/重排序）→ 模型；
      提供方块内维护密钥（脱敏）与 Base URL 并就地承载运行时自检结果，角色在模型卡片上分配
- [x] 设置页：默认处理参数、工具链探测、存储目录（本地 Whisper 配置迁至模型页的本地模型块）
- [x] 删除旧视图：`study-view`、`knowledge-view`、`history-view`、`diagnostics-view`、`settings-view`、
      `task-processing-workbench`、`custom-skin-dialog`、`app-background-layer`、`webgl-blur-canvas`、`sidebar`

## 5. 验证

- [x] 单元测试：文本工具（时间码/分词/JSON 抽取/预算切分）、语义分段、章节窗口、BM25、切块、RRF、引用校验
- [x] 单元测试：模型分组与角色分配（`model-groups`：两域分组、提供方分块、能力细分、角色互斥与路由顺序）
- [x] `pnpm typecheck`（contracts / api / desktop 全绿）
- [x] `pnpm --filter @vidgnost/api test`（125 项全绿）、`pnpm --filter @vidgnost/desktop test`（38 项全绿）
- [x] 端到端验证：以真实视频跑通 `ingest → audio → transcribe → structure → insight → mindmap → knowledge → vision → index → finalize`
- [x] 续跑验证：进程中断后重启，已完成阶段命中缓存、未完成阶段继续执行
- [x] 检索验证：rerank 命中分数与噪声分数差异显著（0.40 vs 0.005），引用可映射回具体时间区间
- [x] 界面验证：桌面窗口下检查资产库、工作台、模型页、设置页的布局与状态；模型页另经浏览器实测两域顺序、
      提供方分块、能力细分与运行时自检结果的就地呈现

## 6. 文档

- [x] `docs/openspec/changes/v3-video-knowledge-engine/`：proposal / design / tasks / 9 份能力规格
- [x] 归档 `build-lightweight-v2`，删除其对应的过时基线规格
- [x] 重写 `README.md` / `README.zh-CN.md`
- [x] 重写 `docs/current-tech-stack.zh-CN.md`
- [x] 更新 `AGENTS.md` 索引
- [x] 移除 `docs/superpowers/**`、`docs/frontend-backend-field-mapping`、`docs/backend-api-and-ops-baseline`、
      `docs/vidgnost-*` 等指向旧架构的过程文档
