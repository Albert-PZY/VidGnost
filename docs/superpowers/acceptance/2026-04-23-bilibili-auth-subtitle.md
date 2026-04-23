# Acceptance Criteria: Bilibili Auth Subtitle

**Spec:** `docs/superpowers/specs/2026-04-23-bilibili-auth-design.md`
**Date:** 2026-04-23
**Status:** Approved

---

## Criteria

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-001 | 设置中心配置接口返回 B 站登录态状态与二维码元数据且不暴露原始 Cookie | API | 后端已启动 | `GET /api/config/bilibili-auth`、二维码启动/轮询/登出接口返回 `status`、`account`、二维码字段与时间戳字段，但响应体中不包含 `cookies` 或任何 `SESSDATA` 明文 |
| AC-002 | B 站登录态字幕客户端按 `view -> player -> subtitle_url` 获取 AI 字幕 | Logic | 后端已持久化有效 B 站会话 | `BilibiliSubtitleClient.fetchBestSubtitle` 返回规范化片段、完整文本、选中轨道元数据与 `source=bilibili-auth` |
| AC-003 | B 站 phase C 优先走登录态 AI 字幕且不触发公共 `yt-dlp` probe | Logic | 任务来源为 `bilibili` 且存在可用 AI 字幕 | `PlatformSubtitleTranscriptService.transcribeFromPlatformSubtitles` 直接返回 `bilibili-auth` 结果，`resolveProbe` 与字幕下载函数均不被调用 |
| AC-004 | B 站登录态字幕不可用时直接回退统一 ASR 链路且不触发公共 `yt-dlp` probe | Logic | 任务来源为 `bilibili` 且 AI 字幕缺失或请求失败 | 编排器最终完成任务并调用 ASR，阶段 C 日志记录“平台字幕不可用，已回退 ASR 转写链路”，`resolveProbe` 与公共字幕下载函数均不被调用 |
| AC-005 | B 站学习域字幕轨物化也不会重新触发公共 `yt-dlp` probe | Logic | 任务来源为 `bilibili`，学习域调用字幕轨物化或读取工作台数据，且无缓存 probe 工件 | `SubtitleTrackService` 只读取缓存 probe 工件并返回 `source=missing + whisper=available` 的轨道结果，不调用 `resolveProbe` |
| AC-006 | YouTube 仍保留 `yt-dlp` 公共字幕优先策略 | Logic | 任务来源为 `youtube` 且存在可用公共字幕轨 | 平台字幕服务返回 `source=yt-dlp` 的转写结果，并且公共字幕 probe 被调用一次 |
| AC-007 | B 站登录态失效时标记会话过期但不阻塞回退 ASR | Logic | 已持久化 B 站会话，播放器接口返回未登录或 403 | 字幕客户端返回 `null`，认证仓库状态更新为 `expired`，phase C 后续仍可继续执行 ASR 回退 |
| AC-008 | Windows 上任务 JSON 写入在短暂 `rename` 冲突下具备有限重试能力 | Logic | 写入目标目录可写，首次 `rename` 抛出 `EPERM`/`EBUSY`/`EACCES` 短暂错误 | `writeJsonFile` 最终成功写入目标文件，且回归测试证明短暂冲突不会直接导致失败 |
