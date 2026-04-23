---
type: contract
title: bilibili-auth-subtitle-fallback
summary: B 站登录态与 AI 字幕回退链路的稳定合同，覆盖后端本地 Cookie 边界、字幕获取顺序与 Study 只读场景的 cached probe 规则。
tags:
  - contract
  - bilibili
  - subtitles
  - study
owned_paths:
  - apps/api/src/modules/bilibili-auth
  - apps/api/src/modules/asr/platform-subtitle-transcript-service.ts
  - apps/api/src/modules/subtitles/platform-subtitle-probe-service.ts
  - apps/api/src/modules/study/study-service.ts
  - apps/api/src/modules/study/subtitle-track-service.ts
  - apps/api/src/routes/config.ts
  - apps/desktop/src/components/views/settings-view.tsx
  - packages/contracts/src/config.ts
related_docs:
  - docs/bilibili-auth-subtitle-plan.zh-CN.md
  - docs/openspec/specs/transcription-pipeline/spec.md
  - docs/openspec/specs/llm-runtime-config/spec.md
  - docs/openspec/specs/video-ingestion/spec.md
  - docs/openspec/specs/web-workbench-ui/spec.md
entrypoints:
  - /F:/in-house project/VidGnost/apps/api/src/modules/bilibili-auth/bilibili-login-service.ts
  - /F:/in-house project/VidGnost/apps/api/src/modules/bilibili-auth/bilibili-subtitle-client.ts
  - /F:/in-house project/VidGnost/apps/api/src/modules/asr/platform-subtitle-transcript-service.ts
  - /F:/in-house project/VidGnost/apps/api/src/modules/study/study-service.ts
status: active
---

# Bilibili Auth Subtitle Fallback Contract

## Scope

适用于 `source_type=bilibili` 的登录态管理、AI 字幕优先链路以及 Study 预览类接口的字幕探测读取规则。

## State And Interface Rules

- 前端设置中心只读取 `/api/config/bilibili-auth*` 返回的状态字段与二维码元数据，不读取也不展示原始 Cookie。
- 后端本地持久化记录只用于服务端会话管理，可包含 `cookies`、`pending_login`、`account`、`status`、`expires_at`、`last_validated_at`、`last_error`、`updated_at`。
- 稳定状态枚举为：
  - `missing`
  - `pending`
  - `active`
  - `expired`
- 二维码轮询状态枚举为：
  - `pending`
  - `scanned`
  - `confirmed`
  - `success`
  - `expired`
  - `failed`

## Fallback Order

- `source_type=bilibili` 的 phase `C` 转写顺序固定为：
  - `bilibili` 登录态 AI 字幕
  - `Whisper / remote ASR`
- B 站转写链路不再先调用 `yt-dlp` 公共字幕 probe/download；`yt-dlp` 公共字幕策略仅保留给非 B 站来源如 YouTube。
- 登录态 AI 字幕命中后，任务工件至少保留：
  - `C/platform-subtitles/bilibili-auth-raw.json`
  - `C/platform-subtitles/selected-track.json`

## Expiry Rules

- 若 B 站登录态字幕接口出现未登录或权限失效信号，后端必须将登录态标记为 `expired`。
- `401/403` 响应即使返回非 JSON 内容，也必须被视为失效信号并触发 `expired` 标记。
- 登录态失效不会让任务失败；转写链路必须继续回退到 Whisper 或远程 ASR。

## Study Read Rules

- `study-preview`、`study-pack`、`tasks` 列表预览等只读场景不能在缓存缺失时在线触发 `yt-dlp` 探测。
- 只读场景必须走 `probeMode: "cached"`，只消费已存在的字幕探测缓存。
- 真正需要物化字幕轨的流程才允许走 `probeMode: "materialize"`。

## Invariants

- 原始 Cookie 不进入前端状态、不进入日志、不进入任务工件。
- B 站登录态状态与 UI 设置分离，不能并入 `UISettings` 通用配置结构。
- Study 只读接口不能因为平台字幕探测而阻塞用户查看已完成任务。
