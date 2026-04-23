# VidGnost Bilibili Auth Design

**Date:** 2026-04-23
**Status:** Approved

## Scope

This design adds a Bilibili QR login surface to the existing settings center, persists a task-independent Bilibili cookie session on the backend only, and routes Bilibili transcription through logged-in Bilibili AI subtitles before Whisper or remote ASR.

The delivery covers:

- dedicated config routes for status, QR-code login start, QR polling, and logout
- task-independent Bilibili auth persistence in `storage/config`
- session status, logout, and expiry handling
- Bilibili-auth subtitle client for `bvid -> aid/cid -> player -> subtitle_url`
- desktop settings UI for login status and QR workflow

## Architecture

### Backend Auth Module

Add a dedicated `apps/api/src/modules/bilibili-auth/` module group:

- `BilibiliAuthRepository` persists a normalized record with account metadata, cookie whitelist, pending QR metadata, timestamps, and last error.
- `BilibiliLoginService` owns QR generation, QR polling, cookie extraction, session validation, and logout.
- `BilibiliSubtitleClient` uses persisted cookies to resolve logged-in subtitle metadata and subtitle JSON for Bilibili videos.

The auth module remains separate from `UiSettingsRepository`. Bilibili login is operational state, not a generic UI preference.

### Subtitle Fallback Chain

The phase-`C` order is source-specific:

1. `source_type=youtube`: shared `yt-dlp` public platform subtitle probe
2. `source_type=bilibili`: logged-in Bilibili AI subtitle resolution, without a public `yt-dlp` subtitle probe
3. existing Whisper / remote ASR fallback when the applicable subtitle path is unavailable

This preserves the existing public-subtitle behavior for non-Bilibili sources while avoiding an extra Bilibili `yt-dlp` subtitle probe that still depends on login-state validation.

### Desktop Settings

Settings gains a dedicated settings section for platform accounts inside the existing settings surface, with the Bilibili login card rendered within that section. The frontend only reads auth status fields (`status`, `account`, `expires_at`, `last_validated_at`, `last_error`) and QR metadata (`qrcode_key`, `qrcode_url`, `qr_image_data_url`, `poll_interval_ms`) from `/config/bilibili-auth*` routes. Raw cookies never flow into renderer state and are never readable by the frontend.

## Data Model

Persist a dedicated config file:

- `storage/config/bilibili-auth.json`

Record fields:

- Backend-local persisted record may include `cookies` and `pending_login` for internal session management.
- Frontend-visible auth status is limited to `status`, `account`, `expires_at`, `last_validated_at`, and `last_error`.
- Frontend-visible QR responses are limited to `status`, `qrcode_key`, `qrcode_url`, `qr_image_data_url`, `expires_at`, `poll_interval_ms`, `message`, and poll-time `account` / `last_error` when applicable.

## Key Decisions

1. Cookies remain plain-text on disk by explicit product choice.
   The backend still restricts them to `storage/config`, excludes them from logs, and never returns them to the renderer.

2. QR login stays backend-driven.
   The backend performs Bilibili HTTP calls and extracts `set-cookie` headers so the renderer never touches session secrets.

3. Bilibili auth is the Bilibili transcript subtitle source.
   Bilibili phase `C` no longer probes public subtitles through `yt-dlp`; the effective order is `Bilibili logged-in AI subtitles -> Whisper/remote ASR`. `yt-dlp` remains available for YouTube public subtitle acquisition.

4. Expired sessions degrade cleanly.
   On auth failure, the backend marks the session `expired` and the subtitle pipeline falls back to the existing ASR path without failing the whole task or blocking the current job.

## Verification

The implementation must ship with:

- config-route tests for Bilibili auth lifecycle
- repository tests for persistence and expiry updates
- subtitle-client tests for `bvid` resolution and subtitle selection
- orchestrator / transcription tests proving Bilibili uses `bilibili-auth -> Whisper` and does not invoke public `yt-dlp` subtitle probing
- desktop API/client tests for QR login status and actions
