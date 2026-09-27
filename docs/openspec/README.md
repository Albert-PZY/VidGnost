# OpenSpec 文档索引

本目录用于管理本项目的 OpenSpec 规范文档与流程资产。

## 1. 当前变更

- Change root：`docs/openspec/changes/v3-video-knowledge-engine/`
- Manifest：`docs/openspec/changes/v3-video-knowledge-engine/.openspec.yaml`
- Proposal：`docs/openspec/changes/v3-video-knowledge-engine/proposal.md`
- Design：`docs/openspec/changes/v3-video-knowledge-engine/design.md`
- Tasks：`docs/openspec/changes/v3-video-knowledge-engine/tasks.md`
- 能力规格：
  - `specs/video-ingestion/spec.md`
  - `specs/transcription-pipeline/spec.md`
  - `specs/insight-generation/spec.md`
  - `specs/visual-enrichment/spec.md`
  - `specs/knowledge-retrieval/spec.md`
  - `specs/model-routing/spec.md`
  - `specs/pipeline-runtime/spec.md`
  - `specs/library-and-export/spec.md`
  - `specs/desktop-studio-ui/spec.md`

本次变更取代 `build-lightweight-v2`，是当前产品与技术基线。

## 2. 基线规格（Base Specs）

稳定后的能力要求沉淀在 `docs/openspec/specs/`，与当前变更的能力目录一一对应：

- `video-ingestion`：来源接入、媒体探测与回放通道
- `transcription-pipeline`：在线文件级 ASR 优先 + 本地兜底 + 转写标准化
- `insight-generation`：语义分段、章节、摘要、导图、知识图谱、校对与翻译
- `visual-enrichment`：关键帧抽取、去重与多模态图注
- `knowledge-retrieval`：切块、混合检索、重排、时间锚定问答
- `model-routing`：提供方配置、角色路由、密钥与自检
- `pipeline-runtime`：阶段引擎、检查点续跑、事件流
- `library-and-export`：资产库索引与导出
- `desktop-studio-ui`：桌面工作台界面与交互契约

## 3. 归档区

已完成的旧 change 归档在 `docs/openspec/changes/archive/`：

- `build-lightweight-v2-archived/`：study-first 学习工作台基线（已被 v3 取代）

归档规则见 `docs/openspec/changes/archive/README.md`。

## 4. 模板区

新建 change 时从 `docs/openspec/templates/change-template/` 复制。

## 5. 状态词汇

能力状态只允许使用三个词，并在规格中用 `Status: ``...`` ` 标注：

- `planned`：已设计但尚无代码
- `partial`：代码存在但未覆盖全部场景
- `implemented`：代码、测试、规格与验证证据齐备

## 6. 校验

```bash
node scripts/check-openspec.mjs
```
