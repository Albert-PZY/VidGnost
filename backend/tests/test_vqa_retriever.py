from app.services.vqa_ollama_retriever import _tokenize


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
