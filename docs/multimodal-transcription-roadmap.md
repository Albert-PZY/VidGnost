# VidSense 多模态转录与笔记增强技术执行方案

更新时间：2026-04-02  
适用范围：本地离线优先部署的 VidSense 项目（前后端分离架构）

## 1. 方案目标

基于前几轮需求，构建一套可渐进落地的能力体系：

1. 转录结果可导出带时间戳文本与字幕（SRT/VTT）。
2. 引入 LLM 纠错提升文本准确度，且不破坏时间轴。
3. 增加视频抽帧识别（OCR/视觉理解）增强笔记质量，避免仅凭音频总结。
4. 引入术语库与片段级检索，控制 token 成本。
5. 降低普通用户使用门槛，支持便携包与安装包交付。

## 2. 当前项目基线（与代码现状对齐）

已具备增量改造基础，无需重构：

1. 已有分段转录数据结构（`start/end/text`）并写入 `transcript_segments_json`。
2. 已有任务详情返回 `transcript_segments`。
3. 已有导出接口骨架 `GET /api/tasks/{task_id}/export/{kind}`。
4. 当前导出类型已包含 `transcript|summary|notes|mindmap|srt|vtt|bundle`。
5. 当前转录引擎为 `faster-whisper`（GPU-only 配置），本方案不引入 `whisper.cpp`。

对应代码位置：

1. `backend/app/models.py`
2. `backend/app/services/task_runner.py`
3. `backend/app/api/routes_tasks.py`

## 3. 对标项目与可借鉴做法

### 3.1 字幕导出与本地化体验

1. Whisper-WebUI：支持 TXT/VTT/SRT/TSV/JSON，多安装路径（自动脚本、Docker、手动）。
2. whishper：本地/自托管定位明确，支持 txt/srt/vtt 导出。

结论：字幕导出应作为核心能力而非附加功能。

### 3.2 视频抽帧与镜头切分

1. PySceneDetect：工程化成熟，支持多检测策略，适合先落地。
2. TransNetV2：镜头边界检测精度更高，适合“高质量模式”。
3. FFmpeg scene filter：可作为轻量级快速抽帧兜底方案。

### 3.3 视觉理解与笔记增强

1. PaddleOCR：本地可部署的 OCR 组件，适合提取课件/屏幕文字。
2. lecture2notes：抽帧、去重、OCR 与语音融合的典型流程。
3. Video-LLaVA / 多模态 RAG 视频示例：可用于高阶视觉语义补充。

### 3.4 本地分发与安装

1. Tauri Sidecar：可将后端进程作为 sidecar 打包，降低用户手工配置成本。

## 4. 分阶段执行路线

### P0（1-2 周）：时间戳文本 + SRT/VTT 导出

#### 目标

1. 新增稳定字幕导出能力。
2. 保持与现有任务导出系统兼容。

#### 设计

1. 新增导出类型：`srt`、`vtt`。
2. 复用 `transcript_segments` 生成字幕，不新增存储字段。
3. 字幕格式化层与 ASR 引擎解耦：
   1. 输入统一为 `transcript_segments(start/end/text)`。
   2. `SRT/VTT` 生成逻辑不依赖具体转录引擎（`faster-whisper`/其他）。
4. 时间格式：
   1. SRT：`HH:MM:SS,mmm`
   2. VTT：`HH:MM:SS.mmm`
5. 边界修复规则：
   1. `end <= start` 自动补偿最小时长（建议 300ms）。
   2. 重叠段自动裁剪。
   3. 空文本段过滤。
6. `bundle` 中追加 `.srt/.vtt`。

#### 验收

1. 成功任务可导出 txt/md/srt/vtt。
2. 主流播放器可直接加载字幕。
3. 导出失败有明确错误信息且不影响其他导出。

### P1（1-2 周）：LLM 纠错（严格模式优先）

#### 目标

在不改时间轴前提下提升可读性和术语准确度。

#### 设计

1. 双模式：
   1. `strict`：仅改文本，段数和顺序不变。
   2. `rewrite`：全文润色，不回写时间轴，仅作为阅读稿。
2. 结构化输出：
   1. 强制 JSON schema。
   2. 输入 N 段，输出必须 N 段。
3. 分批纠错：
   1. 以 token 窗口分批，带少量上下文重叠。
4. 回退策略：
   1. 校验失败或模型失败时回退原文。

#### 验收

1. 时间轴零漂移。
2. 术语一致性提升。
3. 纠错异常不影响任务完成。

### P2（2-4 周）：视频抽帧识别增强笔记（新增重点）

#### 目标

将视觉证据纳入摘要/笔记，提升事实覆盖和准确度。

#### 设计

抽帧层（双档可选）：
1. 快速档：FFmpeg 场景检测 或 PySceneDetect（ThresholdDetector）。
2. 精准档：PySceneDetect — AdaptiveDetector（自适应检测器）。

关键帧策略：
1. 每镜头取中间帧。
2. 长镜头间隔补帧（如每 4-6 秒）。
3. pHash 去重与模糊、黑屏、过亮等无效帧过滤。

视觉解析：
1. OCR：PaddleOCR（中英文离线画面文字提取）。
2. 视觉描述：可选轻量多模态模型（如 Video-LLaVA），仅在 GPU 模式启用，资源不足时自动关闭。

时间对齐融合：
1. 为每个音频片段构建证据包：ASR + OCR + 视觉描述。
2. 以时间戳重叠关系进行音画片段关联。

笔记生成策略：
1. 依据多模态证据包生成内容，并附加时间锚点。
2. 输出结构化章节，支持关键帧缩略图索引与时间跳转。

#### 降级策略

1. 无 GPU：保留抽帧 + OCR。
2. 视觉模型不可用：关闭视觉描述，不阻断任务。

#### 验收

1. 对课件类视频的关键信息覆盖率显著提升。
2. 无 GPU 设备可稳定运行基础增强链路。

### P3（并行推进）：术语库与低 token 片段检索

#### 目标

只注入当前片段相关术语，降低成本并提升准确度。

#### 设计

1. 本地文件术语表（JSON）：`term`、`aliases`、`definition`、`lang`、`priority`。
2. 检索流程：
   1. 精确匹配（term/alias）。
   2. 轻量模糊匹配（编辑距离/trigram）。
   3. TopK 截断（建议 3-8）。
3. 注入策略：
   1. 只注入命中术语与短释义。
   2. 严格术语 token 上限。

#### 验收

1. 术语误写率下降。
2. token 增量可控。

### P4（产品化）：源码版 / 便携包 / 安装包

#### 目标

让普通用户“下载后可直接使用”，弱化环境配置门槛。

#### 设计

1. 源码版：面向开发者，保留当前工作流。
2. 便携包：内置依赖与一键启动脚本。
3. 安装包：Tauri sidecar 统一分发前端与后端。
4. 首启自检：端口、模型、依赖、GPU 库完整性。

#### 验收

1. 用户无需手工开前后端。
2. 异常可一键诊断并给出修复提示。

## 5. 统一任务流水线建议

建议采用“宏阶段 + 子阶段”的事件化方式，兼容现有 `A/B/C/D` 前后端契约：

1. 宏阶段保持 `A/B/C/D`（不破坏现有 UI 与 SSE 事件消费）。
2. 在事件 payload 中新增 `substage` 字段承载细粒度步骤：
   1. `extract_audio`
   2. `transcribe`
   3. `scene_detect`
   4. `keyframe_extract`
   5. `ocr`
   6. `vision_caption`（可选）
   7. `llm_correct`（可选）
   8. `summarize`
   9. `export`

每阶段记录：开始时间、耗时、状态、错误码、降级信息。

## 6. 风险与规避

1. 性能风险：视觉模型耗时高。
2. 稳定性风险：多模型链路失败率上升。
3. 成本风险：LLM token 增长。
4. 交付风险：本地环境复杂。

对应规避策略：

1. 双档模式 + 默认 OCR-only。
2. 严格阶段回退，不让单阶段阻塞全任务。
3. 片段级术语 TopK + 限长注入。
4. 优先便携包，再推进安装包。

## 7. 实施优先级建议

1. 第一优先级：P0（SRT/VTT）。
2. 第二优先级：P1（strict 纠错）。
3. 第三优先级：P2（抽帧 + OCR 增强）。
4. 第四优先级：P3（术语库片段检索）。
5. 第五优先级：P4（安装包/便携包）。

## 8. 参考链接

1. Whisper-WebUI: https://github.com/jhj0517/Whisper-WebUI
2. whishper: https://github.com/pluja/whishper
3. OpenAI Whisper Processing Guide: https://cookbook.openai.com/examples/whisper_processing_guide
4. OTF transcribe: https://github.com/Open-Technology-Foundation/transcribe
5. PySceneDetect: https://github.com/Breakthrough/PySceneDetect
6. TransNetV2: https://github.com/soCzech/TransNetV2
7. FFmpeg filters: https://ffmpeg.org/ffmpeg-filters.html
8. PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR
9. lecture2notes: https://github.com/HHousen/lecture2notes
10. Video-LLaVA: https://github.com/PKU-YuanGroup/Video-LLaVA
11. Multimodal RAG with videos: https://github.com/botextractai/ai-multimodal-rag-with-videos
12. Tauri Sidecar: https://tauri.app/develop/sidecar/
