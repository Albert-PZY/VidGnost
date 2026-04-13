# VidGnost 任务处理页性能基线与验收记录

## 文档目标

本文档用于把任务处理页性能重构的观测方法、基线样本、验收阈值固定下来，避免后续继续依赖主观“感觉更顺了”的判断方式。

本文档覆盖三类信息：

- 固定测试场景
- 固定采样方法
- 当前首轮基线记录

## 固定测试场景

### 场景 A：长视频任务详情加载

- 环境：浏览器开发态
- 任务样本：`task-20260413-135143`
- 工作流：`notes`
- 关注点：
  - 任务处理页是否可以稳定打开
  - 左右双栏是否正常挂载
  - 任务摘要、阶段进度、转写列表、Markdown 工作区是否能同时渲染

### 场景 B：长转写列表滚动

- 环境：浏览器开发态、Electron 开发态、Electron 打包态
- 任务样本：`task-20260413-135143`
- 关注点：
  - 转写片段滚动是否持续顺畅
  - 证据时间轴与阶段输出切换后是否出现明显卡顿
  - 长列表是否保持虚拟化，只挂载可视窗口附近的条目

### 场景 C：长 Markdown / Mermaid 阅读与编辑

- 环境：浏览器开发态、Electron 开发态、Electron 打包态
- 任务样本：`task-20260413-135143`
- 关注点：
  - 任务笔记页面打开后是否稳定显示
  - 编辑弹窗打开时输入区是否保持即时响应
  - Mermaid 预览是否在进入可视区后再启动渲染

### 场景 D：运行期高频流式刷新

- 环境：浏览器开发态、Electron 开发态、Electron 打包态
- 任务样本：运行中的长视频任务
- 关注点：
  - 流式转写时非当前面板是否保持稳定
  - 阶段动态与问答消息是否采用低优先级刷新
  - 拖动左右分栏时是否仍可顺滑调整

## 采样方法

### 1. 构建基线

执行命令：

```powershell
cd frontend
pnpm exec tsc --noEmit
pnpm build
```

记录项：

- 主入口 JS 体积
- CSS 体积
- Worker 产物体积
- 是否存在超大 chunk 告警

### 2. 浏览器开发态基线

执行方式：

1. 启动后端：`uv run python -m uvicorn app.main:app --host 127.0.0.1 --port 8666`
2. 启动前端：`pnpm dev --host 127.0.0.1 --port 6221`
3. 打开任务 `task-20260413-135143`
4. 记录以下项目：

- 页面是否正常打开
- DOM 节点总数
- 可滚动区域数量
- 虚拟列表当前挂载条目数量
- 浏览器控制台是否存在死循环渲染或 store 快照错误

### 3. Electron 开发态基线

执行方式：

```powershell
cd frontend
pnpm desktop:dev
```

采样步骤：

1. 打开同一个任务样本
2. 使用 Chromium DevTools Performance 录制以下交互：
   - 转写列表滚动 5 秒
   - 左右分栏拖动 5 秒
   - 打开 Markdown 编辑弹窗并输入 10 秒
3. 记录：
   - Long Tasks 数量
   - 最大单次 Main Thread Task
   - FPS 下降时段
   - 内存曲线是否持续抬升

### 4. Electron 打包态基线

执行方式：

```powershell
cd frontend
pnpm build
```

打包后在桌面包中重复 Electron 开发态的同一套录制动作，并记录相同指标。验收以打包态为准，不以浏览器开发态替代。

## 当前首轮基线记录

### 1. 构建结果

采样时间：`2026-04-13`

- `pnpm exec tsc --noEmit`：通过
- `pnpm build`：通过
- 主入口 JS：`dist/assets/index-BxdTPaLy.js`，`2420.05 kB`，gzip `735.44 kB`
- 主样式：`dist/assets/index-CNAqpVBs.css`，`240.53 kB`，gzip `32.51 kB`
- Markdown Worker：`dist/assets/markdown-decorate.worker-D9gn5wkv.js`，`1.19 kB`
- 当前仍存在 Vite 超大 chunk 告警，主入口与 Mermaid / Cytoscape 相关产物仍是后续拆包重点

### 2. 浏览器开发态自动采样

采样页面：`http://127.0.0.1:6221`

采样任务：

- `task-20260413-135143`
- 标题：`task-20260413-135143_42RAG-V2 混合检索`
- 时长：`2145.4s`
- 阶段状态：`completed`

自动采样记录：

- 任务处理页可稳定打开
- DOM 节点数：`787`
- 检测到的滚动区域数量：`7`
- 虚拟列表当前挂载条目数：`14`
- 任务处理页打开后未再出现 `Maximum update depth exceeded` 这类 selector 死循环错误

说明：

- 通过 Playwright 自动化环境采集 `requestAnimationFrame` 帧间隔会受到自动化调度影响，不作为 FPS 最终基线。
- FPS、输入延迟、最大 commit 时间以 Electron DevTools Performance 人工录制结果为准。

### 3. 任务样本业务规模

来源：`GET /api/tasks/task-20260413-135143`

- 工作流：`notes`
- 阶段数：`4`
- 音频提取：`0:03`
- 语音转写：`3:54`
- 文本纠错：`0:00`
- 笔记生成：`2:07`
- 产物总大小：`120989 bytes`
- 产物索引项数：`5`

## 验收阈值

### 浏览器开发态

- 打开任务处理页时不得出现 React 死循环、store 快照无限变化、或渲染层崩溃
- 长列表应保持虚拟化，可视窗口附近挂载条目数量应远小于总数据量
- Markdown 工作区与转写列表同时存在时，页面仍应可滚动、可切页、可点击

### Electron 开发态

- 转写滚动与分栏拖动期间不得出现肉眼明显冻结
- 非当前面板更新不得牵连整页同步抖动
- Markdown 编辑器输入应保持连续，不得出现字符延迟堆积
- 连续运行 30 分钟后，内存曲线不应呈单向无界上涨

### Electron 打包态

- 打包态体验不得劣于 Electron 开发态
- 任务处理页打开、滚动、编辑、拖动分栏四类动作都应稳定可用
- 打包态 Performance 录制中，长任务数量和最大单次主线程阻塞应低于重构前版本

## 当前结论

当前这轮重构已经完成以下关键收口：

- 高频运行态数据从根组件状态迁移到 task-scoped Zustand store
- SSE 事件采用 `requestAnimationFrame` 合批
- 长列表改为虚拟化渲染
- Markdown 预处理迁移到 Worker
- Mermaid 预览采用可视区惰性渲染、空闲调度与 SVG 缓存
- 任务处理页高频视觉区域改为低成本合成表面

当前仍需持续关注的后续重点：

- 主入口 bundle 仍偏大，需要继续拆分 Mermaid / 可视化相关产物
- Electron DevTools Performance 仍需按本文档流程持续补充打包态对比记录
