# OpenSpec 基线规格（Base Specs）

本目录存放“稳定能力”的长期规格定义。

## 当前能力列表

- `video-ingestion`
- `transcription-pipeline`
- `sse-runtime-stream`
- `llm-runtime-config`
- `llm-summary-mindmap`
- `history-and-export`
- `web-workbench-ui`

## 维护原则

1. 变更期先更新 `docs/openspec/changes/<change-id>/specs`。
2. 功能稳定后，再同步到本目录作为基线。
3. 基线更新完成后，再归档对应 change。
4. 只要项目代码发生变更，就要同步检查受影响 spec 的覆盖范围与信息密度。
5. 当实现新增或细化了接口、状态、参数、约束、错误处理、关键 UI 行为时，spec 必须在同次交付中同步补齐，不允许代码细节已经落地而 spec 仍停留在粗粒度描述。
