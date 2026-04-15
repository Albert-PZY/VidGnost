from pathlib import Path

from app.services.vqa_ollama_retriever import _normalize_task_frame_image_path, _tokenize


def test_tokenize_keeps_cjk_bigrams_when_text_contains_digits() -> None:
    tokens = _tokenize("测试关键帧 1")

    assert "1" in tokens
    assert "测试" in tokens
    assert "关键" in tokens
    assert "键帧" in tokens


def test_tokenize_keeps_english_words_and_cjk_bigrams_in_mixed_text() -> None:
    tokens = _tokenize("scene 关键帧 frame 2")

    assert "scene" in tokens
    assert "frame" in tokens
    assert "关键" in tokens
    assert "键帧" in tokens
    assert "2" in tokens


def test_normalize_task_frame_image_path_rejects_non_frame_artifacts(tmp_path: Path) -> None:
    storage_dir = tmp_path / "storage"
    task_id = "task-demo"
    frames_dir = storage_dir / "tasks" / "stage-artifacts" / task_id / "D" / "fusion" / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    frame_path = frames_dir / "frame-000001.jpg"
    frame_path.write_bytes(b"frame")

    assert _normalize_task_frame_image_path(storage_dir, task_id, "frames/frame-000001.jpg") == "frames/frame-000001.jpg"
    assert _normalize_task_frame_image_path(storage_dir, task_id, str(frame_path)) == "frames/frame-000001.jpg"
    assert _normalize_task_frame_image_path(storage_dir, task_id, "notes-images/mermaid-002.png") == ""
    assert _normalize_task_frame_image_path(storage_dir, task_id, "../frames/frame-000001.jpg") == ""
