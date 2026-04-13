# VidGnost 任务处理页性能重构方案

## 文档目标

本文档面向 VidGnost 当前任务处理页的交互卡顿问题，聚焦以下目标：

- 解释当前页面在 Electron 与浏览器环境中的主要性能现象。
- 从状态组织、渲染结构、样式合成、重型计算四个层面定位问题原因。
- 给出一套可执行、可分阶段落地的重构方案与执行清单。
- 为后续性能改造提供统一的设计约束，避免继续通过零散补丁堆叠局部优化。

本文档讨论对象主要包括以下模块：

- `frontend/components/views/task-processing-workbench.tsx`
- `frontend/components/editors/prompt-markdown-editor.tsx`
- `frontend/components/ui/markdown-artifact-viewer.tsx`
- `frontend/components/views/research-board-panel.tsx`
- `frontend/app/globals.css`

## 当前问题总览

任务处理页当前已经具备一定的局部优化基础，例如：

- 列表卡片已经使用 `content-visibility`、`contain`、`contain-intrinsic-size`。
- 多个子面板已经通过 `React.memo` 包裹。
- 阶段数据刷新已经存在 450ms 定时回补逻辑。

现阶段卡顿依旧明显，说明瓶颈已经不再停留在单个组件是否包了 `memo`，而是进入了以下更高层级的问题：

- 流式事件直接驱动根组件多路状态更新。
- 长列表数据结构采用全量合并与全量排序。
- 列表视图没有引入虚拟化，仅依赖 CSS 级跳过绘制。
- 流式问答与 Markdown 工作区在主线程持续进行重型解析和重绘。
- 壁纸态的多层玻璃拟态与滚动区域、流式内容区域叠加，放大了 Electron renderer 的合成开销。

## 问题分析

### 1. 流式任务推进时，整个工作台会持续抖动

**现象**

- 任务运行期间，用户在任务处理页切换页签、滚动转写片段、拖动分栏、点击按钮时，会明显感知到输入延迟和滚动不顺畅。
- 任务运行越活跃，界面交互越容易卡顿。
- 这种卡顿在 Electron 中比浏览器更明显。

**原因**

- `TaskProcessingWorkbench` 根组件集中持有大量状态，见 `frontend/components/views/task-processing-workbench.tsx:962-994`。
- SSE 事件在 `frontend/components/views/task-processing-workbench.tsx:1086-1149` 中直接触发多路 `setState`：
  - `setLiveTranscriptSegments`
  - `setCorrectionPreview`
  - `setTask`
  - `setTaskEvents`
- 这类更新由根组件统一承接，会让左侧视频、转写区、阶段区、右侧笔记区、右侧问答区共享同一条渲染路径。
- 当前状态提升层级过高，导致与任务运行无关的交互也会被连带拖慢。

**解决方法**

- 建立任务处理页专用 runtime store，把状态拆分为独立 slice：
  - 任务元信息 slice
  - 转写流 slice
  - 文本纠错预览 slice
  - 阶段动态 slice
  - VQA 对话 slice
  - Trace 缓存 slice
  - Markdown 草稿 slice
- EventSource 只负责写入 store，不直接驱动根组件本地状态。
- UI 通过 selector 订阅局部数据，让左侧转写区、右侧问答区、页头进度区分别独立重渲。
- 优先采用 `useSyncExternalStore` 或 Zustand 这类面向 selector 的方案，避免继续把任务流式状态堆在单个组件里。
- 对低优先级的刷新采用 `startTransition` 或延迟订阅，优先保障输入、滚动、拖动、视频控制的响应优先级。

### 2. 转写片段数量增加后，流式更新的单位成本持续上升

**现象**

- 短视频任务开始时页面还能勉强跟得上。
- 长视频进入转写阶段后，随着片段变多，流式更新越来越重。
- 转写区与证据时间轴的滚动流畅度会随着数据量增加而持续下降。

**原因**

- `mergeTranscriptSegments` 位于 `frontend/components/views/task-processing-workbench.tsx:647-670`。
- 当前实现每次接收到新片段时都会：
  - 重建 `Map`
  - 合并历史数组与新增数组
  - 重新 `sort`
  - 输出一份全新数组
- 这意味着更新成本会随着片段总数上升而上升。
- 该函数还在多个位置重复参与合并：
  - 流式转写增量
  - 纠错预览增量
  - 有效转写片段拼接
  - 持久化片段回补

**解决方法**

- 采用“规范化增量模型”组织转写数据：
  - 内部维护 `Map<segmentKey, segment>`
  - 单独维护稳定顺序索引
  - 新片段到达时只做定点插入或覆盖
- 把“排序”从每条事件执行一次，收敛为：
  - 初始化时排序一次
  - 批量 flush 后按新增范围修正顺序
- 对 SSE 片段更新采用批量写入：
  - 进入事件队列
  - 由 `requestAnimationFrame` 或 80ms 至 120ms 节拍统一 flush
- 对纠错预览也采用同样的增量 patch 机制，避免 strict 对照区重复全量合并。

### 3. 长列表 DOM 数量过大，CSS 优化不足以替代虚拟化

**现象**

- 转写片段很多时，滚动开始变重。
- 证据时间轴、阶段动态、VQA 证据命中列表在数据积累后同样存在滑动卡顿。
- 当前页面在“看起来已经只展示一部分内容”的情况下，交互仍然沉重。

**原因**

- 转写片段在 `frontend/components/views/task-processing-workbench.tsx:2507-2532` 直接全量 `map`。
- 流式问答列表在 `frontend/components/views/task-processing-workbench.tsx:2862-2911` 直接全量 `map`。
- 现有 `.workbench-collection-item` 在 `frontend/app/globals.css:1437-1440` 已经启用：
  - `content-visibility: auto`
  - `contain: layout paint style`
  - `contain-intrinsic-size`
- 这些 CSS 能减少离屏绘制，但不能避免：
  - React 仍然参与整批列表 diff
  - 大量节点仍然驻留在 DOM
  - 事件更新时仍然要遍历完整渲染树

**解决方法**

- 为以下区域引入虚拟列表：
  - 转写片段
  - 证据时间轴
  - 阶段动态
  - VQA 引用列表
- 优先选用支持动态高度的虚拟化方案，例如 `@tanstack/react-virtual`。
- 列表项组件继续保留 `content-visibility` 与 `contain` 作为辅助层，而不是主优化层。
- 建立统一的列表渲染约束：
  - 默认仅渲染可视窗口前后少量缓冲区
  - 不在滚动容器内保留无限增长的子节点树

### 4. Markdown、Mermaid 与流式问答在主线程持续争抢时间片

**现象**

- 流式问答生成过程中，回答气泡容易拖慢同页交互。
- Markdown 工作区打开编辑弹窗后，输入、预览、Mermaid 预览叠加时更容易出现延迟。
- 当内容较长、包含代码块、时间戳、图片、Mermaid 时，卡顿更明显。

**原因**

- `PromptMarkdownEditor` 在 `frontend/components/editors/prompt-markdown-editor.tsx:67-84` 采用 `preview="live"`。
- `MarkdownArtifactViewer` 在 `frontend/components/ui/markdown-artifact-viewer.tsx` 中会执行：
  - 相对图片路径重写
  - 时间戳装饰
  - Markdown 渲染
  - Mermaid 代码块预览
- 流式问答区域在回答生成过程中不断更新 `message.content`，每次增量都可能触发 Markdown 重新解析和渲染。
- 这些操作全部发生在 renderer 主线程，与滚动、拖动、点击、视频控制共享时间片。

**解决方法**

- 对流式问答采用“两阶段渲染”：
  - 流式生成阶段以纯文本气泡为主
  - 回答完成后再进行 Markdown 渲染
- 对长回答在流式阶段加入最小刷新节拍，例如 120ms 至 200ms 合批。
- 对笔记编辑器采用“实时编辑 + 延迟预览”策略：
  - 编辑区即时响应
  - 预览区在短时间片后更新
- 对 Mermaid 与重型 Markdown 装饰建立 Worker 侧计算链路：
  - 主线程只负责展示结果
  - 解析、预处理、索引等逻辑在 Worker 中完成

### 5. 壁纸态多层玻璃拟态放大了 Electron 合成成本

**现象**

- 浏览器环境中效果还能接受，但 Electron 中掉帧更明显。
- 壁纸态下任务处理页比普通纯色背景状态更卡。
- 阅读区、线索篮、列表卡片叠加后，滚动和更新更容易不稳定。

**原因**

- `frontend/app/globals.css:1804-1825` 为阅读面板、线索篮、线索卡片叠加了多层：
  - 半透明背景
  - `backdrop-filter`
  - 阴影
- 这些区域同时也是：
  - 高频滚动区域
  - 高频内容更新区域
  - 高节点密度区域
- 在 Electron renderer 中，这类区域的合成、重绘、混合成本会比普通网页场景更敏感。

**解决方法**

- 任务处理页采用“单层玻璃外壳 + 内层低成本实体面板”策略：
  - 外层工作台壳体保留品牌氛围
  - 内层高频交互区域使用半透明纯色或低成本渐变
- 对滚动区、转写区、问答区、线索篮卡片统一使用轻量背景，不让每个局部面板再承担实时模糊合成。
- 将视觉重点从高频模糊效果转为：
  - 清晰层级
  - 稳定边界
  - 低成本对比度

### 6. 当前页面缺少针对 Electron 打包态的正式性能基线

**现象**

- 用户能感知页面卡顿，但难以判断最主要的耗时环节是：
  - 状态更新
  - 列表渲染
  - Markdown 解析
  - 毛玻璃合成
  - Electron 开发态额外负担
- 优化动作容易陷入“局部修补后继续观察”的循环。

**原因**

- 当前缺少面向任务处理页的统一 profiling 基线。
- 开发态与 Electron 打包态的表现差异没有被固定记录。
- 页面内缺少针对长列表、长任务、流式问答的性能采样点。

**解决方法**

- 建立任务处理页专项性能测量基线：
  - Electron 打包态
  - Electron 开发态
  - 浏览器开发态
- 固定采样场景：
  - 长视频转写进行中
  - 转写片段 500 条以上
  - VQA 流式长回答
  - Markdown 编辑器打开并包含 Mermaid
- 固定采样指标：
  - 主线程长任务数量
  - 最大单次 commit 时长
  - 滚动帧率
  - 输入延迟
  - 内存占用与节点数
- 把 profiling 结果作为每一阶段重构后的验收基线。

## 重构设计原则

### 原则 1：流式数据与视图渲染解耦

任务事件属于 runtime 层数据，不应直接让根组件承担所有状态同步职责。

### 原则 2：把单位更新成本固定在小常数范围

任何单条流式事件都不应触发：

- 全量数组重建
- 全量列表 diff
- 多块重型视图同时刷新

### 原则 3：重型计算让出主线程

Markdown 装饰、Mermaid 解析、长文本预处理、次要日志整理应优先采用：

- Worker
- 合批刷新
- 延迟预览
- 非阻塞过渡

### 原则 4：高频交互区优先稳定，不优先追求视觉特效强度

任务处理页的第一目标是稳、快、连续；在此基础上再保留必要的品牌视觉氛围。

## 重构执行清单

### P0 基线与观测

- [ ] 建立任务处理页专项 profiling 方案，覆盖浏览器开发态、Electron 开发态、Electron 打包态。
- [ ] 固定四个标准测试场景：长视频转写、长转写列表、长 VQA 回答、Markdown 编辑器 + Mermaid。
- [ ] 记录首轮基线数据：最大 commit 时间、长任务数量、滚动帧率、输入延迟、节点数量、内存占用。
- [ ] 在文档中补充每个场景的采样方法与验收阈值。

### P1 状态层重构

- [ ] 为任务处理页建立 task-scoped runtime store。
- [ ] 把 `task`、`transcript`、`correctionPreview`、`taskEvents`、`chatHistory`、`traceCache`、`notesDraft` 拆分为独立 slice。
- [ ] 把 EventSource 回调从根组件本地 `setState` 迁移为写入 store 的 dispatch。
- [ ] 为左侧工作区、右侧工作区、页头进度区提供 selector 订阅接口。
- [ ] 保证非当前面板的数据更新不会牵连整页根组件 commit。

### P2 流式更新合批

- [ ] 为转写片段流建立事件缓冲队列。
- [ ] 采用 `requestAnimationFrame` 或固定短节拍进行批量 flush。
- [ ] 为纠错预览流采用同样的合批策略。
- [ ] 为阶段动态与次要日志采用更低频的合并刷新节拍。
- [ ] 对非关键 UI 刷新使用 `startTransition` 或等效的低优先级更新策略。

### P3 转写与证据数据结构重构

- [ ] 用规范化结构管理转写片段，建立 `segmentMap + orderedKeys` 模型。
- [ ] 让新增片段只执行局部 patch，不执行全量排序。
- [ ] 为证据时间轴和问答引用建立稳定 ID 与稳定排序策略。
- [ ] 为阶段动态建立定长缓冲与轻量摘要结构，避免每次直接拼接完整事件对象。

### P4 长列表虚拟化

- [ ] 为转写片段接入动态高度虚拟列表。
- [ ] 为证据时间轴接入动态高度虚拟列表。
- [ ] 为阶段动态接入虚拟列表或分页窗口。
- [ ] 为 VQA 引用区接入虚拟列表或折叠式窗口渲染。
- [ ] 保留 `content-visibility` 与 `contain` 作为虚拟列表之上的辅助层。

### P5 Markdown 与 Mermaid 渲染优化

- [ ] 为流式问答建立“流式纯文本展示 + 完成后 Markdown 渲染”的两阶段策略。
- [ ] 为长回答设置最小渲染节拍，避免每个 chunk 即时触发完整预览。
- [ ] 为 Markdown 编辑器建立“编辑实时、预览延迟”的双通道策略。
- [ ] 为 Mermaid 解析与重型 Markdown 预处理建立 Worker 侧执行链路。
- [ ] 为图片路径转换、时间戳装饰等预处理逻辑建立缓存，避免同一内容重复计算。

### P6 视觉合成优化

- [ ] 为任务处理页定义“高频交互区低成本视觉层”规范。
- [ ] 让工作台外层保留统一氛围层，内层阅读区、问答区、线索篮、列表卡片采用轻量背景。
- [ ] 控制滚动区和高频更新区的 `backdrop-filter` 使用范围。
- [ ] 统一高频区域的阴影、边框、透明度方案，避免多层叠加合成。

### P7 交互优先级治理

- [ ] 保障以下交互在任务运行期始终处于最高优先级：滚动、输入、拖拽分栏、视频播放控制、按钮点击。
- [ ] 把阶段日志、次要 badge、非当前 tab 内容降级为后台更新。
- [ ] 为分栏拖动期间的非关键渲染建立临时降频机制。
- [ ] 对需要即时反馈但计算较重的区域统一采用占位态、渐进态、补全态三段式输出。

### P8 验收与回归

- [ ] 对比重构前后的 Electron 打包态性能数据。
- [ ] 验证长视频任务运行期滚动与交互是否稳定在可接受范围。
- [ ] 验证转写区、问答区、Markdown 编辑器在高压场景下不再出现明显输入延迟。
- [ ] 验证视觉层收敛后是否仍符合项目既有 UI 风格。
- [ ] 形成最终的性能验收报告并固化到文档。

## 推荐实施顺序

建议按以下顺序推进，优先解决收益最大的结构性问题：

1. 建立 profiling 基线。
2. 完成状态层重构与 SSE 合批。
3. 完成转写与证据数据结构重构。
4. 完成长列表虚拟化。
5. 完成流式问答与 Markdown 渲染优化。
6. 完成视觉合成层收敛。
7. 完成回归测试与验收。

## 参考资料

- React `memo` 官方文档：`https://react.dev/reference/react/memo`
- React `useDeferredValue` 官方文档：`https://react.dev/reference/react/useDeferredValue`
- React `useTransition` 官方文档：`https://react.dev/reference/react/useTransition`
- web.dev 列表虚拟化文章：`https://web.dev/articles/virtualize-long-lists-react-window`
- Electron 官方性能文档：`https://www.electronjs.org/docs/latest/tutorial/performance`
- MDN `content-visibility`：`https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility`
- MDN Web Workers：`https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API`
- MDN `requestIdleCallback`：`https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback`
