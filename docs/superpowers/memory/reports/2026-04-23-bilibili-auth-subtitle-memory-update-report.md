# Memory Update Report

## Summary

- Scope: B 站登录态、AI 字幕补充链路与 Study 只读 cached probe 规则
- Result: done
- Created docs: 1
- Updated docs: 1
- Major gaps: 2

## Coverage created

- Contracts:
  - `docs/superpowers/memory/contracts/bilibili-auth-subtitle-fallback.md`
- Reports:
  - `docs/superpowers/memory/reports/2026-04-23-bilibili-auth-subtitle-memory-update-report.md`

## Coverage updated

- `docs/superpowers/memory/index.md`

## Durable facts captured

- B 站登录态是后端本地运维状态，不属于通用 `UISettings`
- 前端只消费登录状态和二维码元数据，原始 Cookie 不进入 renderer、日志或任务工件
- B 站字幕补充顺序固定为 `yt-dlp 公共字幕 -> bilibili 登录态 AI 字幕 -> Whisper/remote ASR`
- `401/403` 即使返回非 JSON，也必须把 B 站登录态标记为 `expired`
- `study-preview`、`study-pack` 与任务列表预览等只读场景只能走 cached probe，不能在线触发 `yt-dlp`

## Evidence reviewed

- `docs/bilibili-auth-subtitle-plan.zh-CN.md`
- `apps/api/src/modules/bilibili-auth/*`
- `apps/api/src/modules/asr/platform-subtitle-transcript-service.ts`
- `apps/api/src/modules/subtitles/platform-subtitle-probe-service.ts`
- `apps/api/src/modules/study/study-service.ts`
- `apps/api/src/modules/study/subtitle-track-service.ts`
- `apps/desktop/src/components/views/settings-view.tsx`
- `packages/contracts/src/config.ts`

## Remaining gaps

- 尚未沉淀 B 站二维码登录异常排查 runbook
- 尚未形成平台字幕探测缓存失配的专项恢复手册
