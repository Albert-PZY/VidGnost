# VidGnost Bilibili Auth Design

**Date:** 2026-04-23
**Status:** Approved

## Scope

This design adds a Bilibili QR login surface to the existing settings center, persists a task-independent Bilibili cookie session on the backend only, and extends the current platform-subtitle-first transcription path with a logged-in Bilibili AI subtitle fallback before Whisper or remote ASR.

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

The current phase-`C` order becomes:

1. shared `yt-dlp` public platform subtitle probe
2. logged-in Bilibili AI subtitle resolution when `source_type=bilibili`
3. existing Whisper / remote ASR fallback

This preserves the existing public-subtitle behavior while using login state only when public subtitles are insufficient.

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

3. Bilibili auth is a supplement, not a replacement.
   `yt-dlp` remains the first probe path. Logged-in subtitle access only runs after public subtitle discovery fails to produce usable results, so the effective order is `yt-dlp public subtitles -> Bilibili logged-in AI subtitles -> Whisper/remote ASR`.

4. Expired sessions degrade cleanly.
   On auth failure, the backend marks the session `expired` and the subtitle pipeline falls back to the existing ASR path without failing the whole task or blocking the current job.

## Verification

The implementation must ship with:

- config-route tests for Bilibili auth lifecycle
- repository tests for persistence and expiry updates
- subtitle-client tests for `bvid` resolution and subtitle selection
- orchestrator / transcription tests proving `yt-dlp -> bilibili-auth -> Whisper` fallback order
- desktop API/client tests for QR login status and actions
