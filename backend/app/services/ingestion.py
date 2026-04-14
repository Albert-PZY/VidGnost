from __future__ import annotations

import logging
import re
import shutil
import wave
from dataclasses import dataclass
from pathlib import Path

import ffmpeg
import yt_dlp


ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}
_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class IngestionResult:
    media_path: Path
    title: str
    duration_seconds: float | None


@dataclass(slots=True)
class AudioChunk:
    path: Path
    start_seconds: float
    duration_seconds: float


def sanitize_filename(filename: str) -> str:
    cleaned = re.sub(r"[^\w\-_. ]+", "_", filename.strip())
    return cleaned[:100] if cleaned else "video"


def normalize_bilibili_input(raw_url: str) -> str:
    raw_url = raw_url.strip()
    if raw_url.upper().startswith("BV") and "/" not in raw_url:
        return f"https://www.bilibili.com/video/{raw_url}"
    return raw_url


def download_bilibili_video(task_id: str, url: str, target_dir: Path) -> IngestionResult:
    target_dir.mkdir(parents=True, exist_ok=True)
    normalized_url = normalize_bilibili_input(url)
    output_template = str(target_dir / f"{task_id}.%(ext)s")
    logger = _YtDlpLogger()

    ydl_opts = {
        "format": "bv*+ba/b",
        "outtmpl": output_template,
        "quiet": True,
        "noprogress": True,
        # On some filesystems yt-dlp may emit noisy .part rename errors even when task succeeds.
        # We write directly to the final file name in our temp task directory to avoid that path.
        "nopart": True,
        "logger": logger,
        "noplaylist": True,
        "merge_output_format": "mp4",
        "retries": 8,
        "fragment_retries": 8,
        "file_access_retries": 5,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(normalized_url, download=True)

    title = str(info.get("title") or "Bilibili Video")
    duration = info.get("duration")

    media_path = _locate_downloaded_media(task_id, target_dir)
    return IngestionResult(media_path=media_path, title=title, duration_seconds=float(duration) if duration else None)


def prepare_local_video(task_id: str, source_path: Path, target_dir: Path) -> IngestionResult:
    target_dir.mkdir(parents=True, exist_ok=True)
    if source_path.suffix.lower() not in ALLOWED_VIDEO_EXTENSIONS:
        raise ValueError(f"Unsupported file extension: {source_path.suffix}")
    target_path = target_dir / f"{task_id}{source_path.suffix.lower()}"
    if target_path.exists():
        target_path.unlink()
    try:
        target_path.hardlink_to(source_path)
    except OSError:
        shutil.copy2(source_path, target_path)
    return IngestionResult(
        media_path=target_path,
        title=source_path.stem,
        duration_seconds=probe_media_duration_seconds(target_path),
    )


def extract_audio_wav(media_path: Path, output_path: Path, channels: int = 1, sample_rate: int = 16000) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    (
        ffmpeg.input(str(media_path))
        .output(str(output_path), ac=channels, ar=sample_rate, format="wav")
        .overwrite_output()
        .run(quiet=True)
    )
    return output_path


def probe_media_duration_seconds(media_path: Path) -> float | None:
    try:
        probe = ffmpeg.probe(str(media_path))
    except ffmpeg.Error:
        return None
    except OSError:
        return None

    format_info = probe.get("format") if isinstance(probe, dict) else None
    if not isinstance(format_info, dict):
        return None
    raw_duration = format_info.get("duration")
    try:
        duration = float(raw_duration)
    except (TypeError, ValueError):
        return None
    return duration if duration > 0 else None


def split_audio_wav(audio_path: Path, output_dir: Path, chunk_seconds: int = 180) -> list[AudioChunk]:
    output_dir.mkdir(parents=True, exist_ok=True)
    chunks: list[AudioChunk] = []
    with wave.open(str(audio_path), "rb") as wav_in:
        channels = wav_in.getnchannels()
        sample_width = wav_in.getsampwidth()
        frame_rate = wav_in.getframerate()
        comp_type = wav_in.getcomptype()
        comp_name = wav_in.getcompname()

        frames_per_chunk = int(chunk_seconds * frame_rate)
        total_index = 0
        start_seconds = 0.0
        while True:
            chunk_frames = wav_in.readframes(frames_per_chunk)
            if not chunk_frames:
                break
            chunk_frame_count = len(chunk_frames) // (channels * sample_width)
            duration_seconds = chunk_frame_count / frame_rate if frame_rate else 0.0
            chunk_path = output_dir / f"chunk_{total_index:04d}.wav"
            with wave.open(str(chunk_path), "wb") as wav_out:
                wav_out.setnchannels(channels)
                wav_out.setsampwidth(sample_width)
                wav_out.setframerate(frame_rate)
                wav_out.setcomptype(comp_type, comp_name)
                wav_out.writeframes(chunk_frames)
            chunks.append(
                AudioChunk(
                    path=chunk_path,
                    start_seconds=round(start_seconds, 2),
                    duration_seconds=round(duration_seconds, 2),
                )
            )
            start_seconds += duration_seconds
            total_index += 1
    return chunks


def extract_video_frames(
    media_path: Path,
    output_dir: Path,
    *,
    interval_seconds: float = 10.0,
    quality: int = 4,
) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    for existing in output_dir.glob("frame-*.jpg"):
        existing.unlink(missing_ok=True)

    safe_interval = max(1.0, float(interval_seconds))
    safe_quality = max(2, min(10, int(quality)))
    output_pattern = output_dir / "frame-%06d.jpg"
    (
        ffmpeg.input(str(media_path))
        .output(
            str(output_pattern),
            vf=f"fps=1/{safe_interval}",
            start_number=0,
            **{"qscale:v": safe_quality, "vsync": "vfr"},
        )
        .overwrite_output()
        .run(quiet=True)
    )
    return sorted(output_dir.glob("frame-*.jpg"))


def _locate_downloaded_media(task_id: str, target_dir: Path) -> Path:
    matches = sorted(target_dir.glob(f"{task_id}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not matches:
        raise FileNotFoundError("yt-dlp download completed but file not found")
    return matches[0]


class _YtDlpLogger:
    @staticmethod
    def _is_benign_rename_noise(message: str) -> bool:
        lowered = message.lower()
        return (
            "unable to rename file" in lowered
            and ".part" in lowered
            and "no such file or directory" in lowered
        )

    def debug(self, message: str) -> None:
        # Keep downloader debug output out of terminal to reduce runtime noise.
        _ = message

    def warning(self, message: str) -> None:
        if self._is_benign_rename_noise(message):
            _LOGGER.info("Suppressed non-fatal yt-dlp rename warning: %s", message)
            return
        _LOGGER.warning("yt-dlp: %s", message)

    def error(self, message: str) -> None:
        if self._is_benign_rename_noise(message):
            _LOGGER.info("Suppressed non-fatal yt-dlp rename error: %s", message)
            return
        _LOGGER.error("yt-dlp: %s", message)
