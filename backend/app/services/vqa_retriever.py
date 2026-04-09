from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from pathlib import Path
from typing import Iterable

import orjson

from app.models import TaskRecord, TaskStatus
from app.services.task_store import TaskStore
from app.services.vqa_types import EvidenceDocument, RetrievalHit, SearchResult

_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_]+", re.UNICODE)


class VQAHybridRetriever:
    """Task-based dense+sparse retriever with RRF fusion and rerank."""

    def __init__(
        self,
        *,
        task_store: TaskStore,
        storage_dir: str,
        window_seconds: float = 8.0,
        stride_seconds: float = 4.0,
        dense_top_k: int = 80,
        sparse_top_k: int = 120,
        fused_top_k: int = 40,
        rerank_top_n: int = 8,
        rrf_k: int = 60,
    ) -> None:
        self._task_store = task_store
        self._storage_dir = Path(storage_dir).resolve()
        self._window_seconds = max(1.0, float(window_seconds))
        self._stride_seconds = max(0.5, float(stride_seconds))
        self._dense_top_k = max(1, int(dense_top_k))
        self._sparse_top_k = max(1, int(sparse_top_k))
        self._fused_top_k = max(1, int(fused_top_k))
        self._rerank_top_n = max(1, int(rerank_top_n))
        self._rrf_k = max(1, int(rrf_k))

    def search(
        self,
        query_text: str,
        *,
        task_id: str | None = None,
        video_paths: list[str] | None = None,
        top_k: int | None = None,
    ) -> SearchResult:
        query = (query_text or "").strip()
        if not query:
            return SearchResult(
                query_text="",
                dense_hits=[],
                sparse_hits=[],
                rrf_hits=[],
                rerank_hits=[],
            )

        documents = self._collect_documents(task_id=task_id, video_paths=video_paths)
        if not documents:
            return SearchResult(
                query_text=query,
                dense_hits=[],
                sparse_hits=[],
                rrf_hits=[],
                rerank_hits=[],
            )

        max_top_k = max(1, int(top_k or self._rerank_top_n))
        dense_hits = self._dense_search(query, documents, top_k=max(self._dense_top_k, max_top_k))
        sparse_hits = self._sparse_search(query, documents, top_k=max(self._sparse_top_k, max_top_k))
        rrf_hits = self._rrf_fusion(dense_hits, sparse_hits, top_k=max(self._fused_top_k, max_top_k))
        rerank_hits = self._rerank(query, rrf_hits, top_n=max_top_k)
        return SearchResult(
            query_text=query,
            dense_hits=dense_hits,
            sparse_hits=sparse_hits,
            rrf_hits=rrf_hits,
            rerank_hits=rerank_hits,
        )

    def _collect_documents(
        self,
        *,
        task_id: str | None,
        video_paths: list[str] | None,
    ) -> list[EvidenceDocument]:
        records = self._task_store.list_all()
        selected_task_id = (task_id or "").strip()
        normalized_paths = {
            str(Path(item).expanduser()).strip().casefold()
            for item in (video_paths or [])
            if str(item).strip()
        }
        docs: list[EvidenceDocument] = []
        for record in records:
            if selected_task_id and record.id != selected_task_id:
                continue
            if normalized_paths:
                candidate_path = str(Path(record.source_local_path or record.source_input).expanduser()).strip().casefold()
                if candidate_path not in normalized_paths:
                    continue
            if record.status not in {
                TaskStatus.COMPLETED.value,
                TaskStatus.FAILED.value,
                TaskStatus.CANCELLED.value,
            }:
                continue
            docs.extend(self._build_documents_from_task(record))
        return docs

    def _build_documents_from_task(self, record: TaskRecord) -> list[EvidenceDocument]:
        segments = self._parse_transcript_segments(record)
        if not segments:
            return []
        max_end = max(end for _, end, _ in segments)
        if max_end <= 0:
            return []

        image_paths = self._list_notes_images(record.id)
        documents: list[EvidenceDocument] = []
        cursor = 0.0
        image_index = 0
        while cursor <= max_end:
            start = round(cursor, 3)
            end = round(min(max_end, start + self._window_seconds), 3)
            window_parts = [
                text.strip()
                for seg_start, seg_end, text in segments
                if text.strip() and seg_end > start and seg_start < end
            ]
            if not window_parts:
                cursor += self._stride_seconds
                continue
            text = " ".join(window_parts).strip()
            image_path = image_paths[image_index] if image_index < len(image_paths) else ""
            if image_index < len(image_paths):
                image_index += 1
            source = "audio+visual" if image_path else "audio"
            doc_id = self._doc_id(record=record, start=start, end=end, text=text, source=source, image_path=image_path)
            documents.append(
                EvidenceDocument(
                    doc_id=doc_id,
                    task_id=record.id,
                    task_title=(record.title or record.id).strip() or record.id,
                    video_path=str(record.source_local_path or record.source_input or ""),
                    start=start,
                    end=end,
                    source=source,
                    text=text,
                    image_path=image_path,
                )
            )
            cursor += self._stride_seconds
        return documents

    def _list_notes_images(self, task_id: str) -> list[str]:
        notes_dir = self._storage_dir / "tasks" / "stage-artifacts" / task_id / "D" / "fusion" / "notes-images"
        if not notes_dir.exists() or not notes_dir.is_dir():
            return []
        paths: list[str] = []
        for path in sorted(notes_dir.rglob("*.png")):
            if not path.is_file():
                continue
            try:
                paths.append(str(path.resolve()))
            except OSError:
                continue
        return paths

    @staticmethod
    def _doc_id(
        *,
        record: TaskRecord,
        start: float,
        end: float,
        text: str,
        source: str,
        image_path: str,
    ) -> str:
        raw = f"{record.id}|{start:.3f}|{end:.3f}|{source}|{image_path}|{text}"
        return hashlib.sha1(raw.encode("utf-8"), usedforsecurity=False).hexdigest()

    @staticmethod
    def _parse_transcript_segments(record: TaskRecord) -> list[tuple[float, float, str]]:
        if (record.transcript_segments_json or "").strip():
            try:
                payload = orjson.loads(record.transcript_segments_json or "[]")
                if isinstance(payload, list):
                    parsed: list[tuple[float, float, str]] = []
                    for item in payload:
                        if not isinstance(item, dict):
                            continue
                        start = _to_float(item.get("start"))
                        end = max(start, _to_float(item.get("end")))
                        text = str(item.get("text", "")).strip()
                        if not text:
                            continue
                        parsed.append((start, end, text))
                    if parsed:
                        return parsed
            except orjson.JSONDecodeError:
                pass
        text = (record.transcript_text or "").strip()
        if not text:
            return []
        chunks = [line.strip() for line in text.splitlines() if line.strip()]
        if not chunks:
            return []
        # Fallback segmentation when timestamps are unavailable.
        segments: list[tuple[float, float, str]] = []
        span = 3.0
        cursor = 0.0
        for chunk in chunks:
            start = cursor
            end = cursor + span
            segments.append((start, end, chunk))
            cursor = end
        return segments

    def _dense_search(self, query: str, docs: list[EvidenceDocument], *, top_k: int) -> list[RetrievalHit]:
        scored: list[RetrievalHit] = []
        query_vector = _char_ngram_tf(query)
        for doc in docs:
            score = _cosine_similarity(query_vector, _char_ngram_tf(doc.text))
            scored.append(
                RetrievalHit(
                    doc_id=doc.doc_id,
                    task_id=doc.task_id,
                    task_title=doc.task_title,
                    text=doc.text,
                    video_path=doc.video_path,
                    start=doc.start,
                    end=doc.end,
                    source=doc.source,
                    image_path=doc.image_path,
                    dense_score=score,
                )
            )
        scored.sort(key=lambda item: item.dense_score, reverse=True)
        return scored[: max(1, top_k)]

    def _sparse_search(self, query: str, docs: list[EvidenceDocument], *, top_k: int) -> list[RetrievalHit]:
        scored: list[RetrievalHit] = []
        query_tokens = _tokenize(query)
        for doc in docs:
            text_tokens = _tokenize(doc.text)
            overlap = 0.0
            if query_tokens:
                overlap = len(query_tokens & text_tokens) / max(1, len(query_tokens))
            contains_bonus = 0.15 if query.strip().lower() in doc.text.lower() else 0.0
            sparse_score = min(1.0, overlap + contains_bonus)
            scored.append(
                RetrievalHit(
                    doc_id=doc.doc_id,
                    task_id=doc.task_id,
                    task_title=doc.task_title,
                    text=doc.text,
                    video_path=doc.video_path,
                    start=doc.start,
                    end=doc.end,
                    source=doc.source,
                    image_path=doc.image_path,
                    sparse_score=sparse_score,
                )
            )
        scored.sort(key=lambda item: item.sparse_score, reverse=True)
        return scored[: max(1, top_k)]

    def _rrf_fusion(
        self,
        dense_hits: list[RetrievalHit],
        sparse_hits: list[RetrievalHit],
        *,
        top_k: int,
    ) -> list[RetrievalHit]:
        fused: dict[str, RetrievalHit] = {}
        for rank, hit in enumerate(dense_hits, start=1):
            bucket = fused.get(hit.doc_id)
            if bucket is None:
                bucket = _clone_hit(hit)
                fused[hit.doc_id] = bucket
            bucket.rrf_score += 1.0 / (self._rrf_k + rank)
            bucket.dense_score = max(bucket.dense_score, hit.dense_score)
        for rank, hit in enumerate(sparse_hits, start=1):
            bucket = fused.get(hit.doc_id)
            if bucket is None:
                bucket = _clone_hit(hit)
                fused[hit.doc_id] = bucket
            bucket.rrf_score += 1.0 / (self._rrf_k + rank)
            bucket.sparse_score = max(bucket.sparse_score, hit.sparse_score)
        ranked = sorted(fused.values(), key=lambda item: item.rrf_score, reverse=True)
        return ranked[: max(1, top_k)]

    def _rerank(self, query: str, hits: list[RetrievalHit], *, top_n: int) -> list[RetrievalHit]:
        query_tokens = _tokenize(query)
        query_vector = _char_ngram_tf(query)
        reranked: list[RetrievalHit] = []
        for hit in hits:
            token_overlap = 0.0
            text_tokens = _tokenize(hit.text)
            if query_tokens:
                token_overlap = len(query_tokens & text_tokens) / max(1, len(query_tokens))
            dense_sim = _cosine_similarity(query_vector, _char_ngram_tf(hit.text))
            hit.rerank_score = min(
                1.0,
                0.55 * dense_sim + 0.25 * hit.rrf_score + 0.2 * token_overlap,
            )
            hit.final_score = hit.rerank_score
            reranked.append(hit)
        reranked.sort(key=lambda item: item.final_score, reverse=True)
        return reranked[: max(1, top_n)]


def _clone_hit(hit: RetrievalHit) -> RetrievalHit:
    return RetrievalHit(
        doc_id=hit.doc_id,
        task_id=hit.task_id,
        task_title=hit.task_title,
        text=hit.text,
        video_path=hit.video_path,
        start=hit.start,
        end=hit.end,
        source=hit.source,
        image_path=hit.image_path,
        dense_score=hit.dense_score,
        sparse_score=hit.sparse_score,
        rrf_score=hit.rrf_score,
        rerank_score=hit.rerank_score,
        final_score=hit.final_score,
    )


def _to_float(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _tokenize(text: str) -> set[str]:
    tokens = {match.group(0).lower() for match in _TOKEN_PATTERN.finditer(text)}
    if tokens:
        return tokens
    # CJK fallback: use 2-char grams to avoid empty sparse signal.
    return {text[i : i + 2] for i in range(max(0, len(text) - 1)) if text[i : i + 2].strip()}


def _char_ngram_tf(text: str, n: int = 2) -> Counter[str]:
    normalized = "".join(ch for ch in text.lower() if not ch.isspace())
    if not normalized:
        return Counter()
    if len(normalized) < n:
        return Counter({normalized: 1})
    grams = (normalized[i : i + n] for i in range(len(normalized) - n + 1))
    return Counter(grams)


def _cosine_similarity(left: Counter[str], right: Counter[str]) -> float:
    if not left or not right:
        return 0.0
    common: Iterable[str] = set(left.keys()) & set(right.keys())
    numerator = sum(left[key] * right[key] for key in common)
    left_norm = math.sqrt(sum(value * value for value in left.values()))
    right_norm = math.sqrt(sum(value * value for value in right.values()))
    if left_norm <= 0 or right_norm <= 0:
        return 0.0
    return max(0.0, min(1.0, numerator / (left_norm * right_norm)))
