from __future__ import annotations

import hashlib
import math
import re
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

import orjson

from app.models import TaskRecord, TaskStatus
from app.services.task_store import TaskStore
from app.services.vqa_types import EvidenceDocument, RetrievalHit, SearchResult

_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_]+", re.UNICODE)


class VQAHybridRetriever:
    """Dense + Sparse + RRF + Rerank retriever with optional ChromaDB persistence."""

    def __init__(
        self,
        *,
        task_store: TaskStore,
        storage_dir: str,
        window_seconds: float = 2.0,
        stride_seconds: float = 1.0,
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
        self._embedding_dim = 384
        self._chroma_collection = None
        self._chroma_enabled = False
        self._sparse_db_path: Path | None = self._storage_dir / "vector-index" / "sparse-fts5.sqlite3"
        self._init_chroma()
        self._init_sparse_store()

    def _init_chroma(self) -> None:
        try:
            import chromadb  # type: ignore

            path = self._storage_dir / "vector-index" / "chroma-db"
            path.mkdir(parents=True, exist_ok=True)
            client = chromadb.PersistentClient(path=str(path))
            self._chroma_collection = client.get_or_create_collection(name="video_clips")
            self._chroma_enabled = True
        except Exception:  # noqa: BLE001
            self._chroma_collection = None
            self._chroma_enabled = False

    def _init_sparse_store(self) -> None:
        try:
            assert self._sparse_db_path is not None
            self._sparse_db_path.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(self._sparse_db_path) as conn:
                conn.execute("PRAGMA journal_mode=WAL;")
                conn.execute("PRAGMA synchronous=NORMAL;")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS evidence_docs (
                        doc_id TEXT PRIMARY KEY,
                        task_id TEXT NOT NULL,
                        task_title TEXT NOT NULL,
                        video_path TEXT NOT NULL,
                        start REAL NOT NULL,
                        end REAL NOT NULL,
                        source TEXT NOT NULL,
                        source_set TEXT NOT NULL,
                        image_path TEXT NOT NULL,
                        text TEXT NOT NULL
                    );
                    """
                )
                conn.execute(
                    """
                    CREATE VIRTUAL TABLE IF NOT EXISTS evidence_fts
                    USING fts5(doc_id UNINDEXED, text);
                    """
                )
        except Exception:  # noqa: BLE001
            # FTS5 may be unavailable on some SQLite builds; retriever will auto fallback.
            self._sparse_db_path = None

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
            return SearchResult(query_text="", dense_hits=[], sparse_hits=[], rrf_hits=[], rerank_hits=[])

        documents = self._collect_documents(task_id=task_id, video_paths=video_paths)
        if not documents:
            return SearchResult(query_text=query, dense_hits=[], sparse_hits=[], rrf_hits=[], rerank_hits=[])

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
            source_set = ["audio"]
            if image_path:
                source_set.append("visual")
            source = "+".join(source_set)
            doc_id = self._doc_id(
                record=record,
                start=start,
                end=end,
                text=text,
                source=source,
                image_path=image_path,
            )
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
                    language=(record.language or "unknown").strip() or "unknown",
                    source_set=source_set,
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
        if self._chroma_enabled and self._chroma_collection is not None:
            return self._dense_search_by_chroma(query, docs, top_k=top_k)
        return self._dense_search_fallback(query, docs, top_k=top_k)

    def _dense_search_by_chroma(self, query: str, docs: list[EvidenceDocument], *, top_k: int) -> list[RetrievalHit]:
        collection = self._chroma_collection
        if collection is None:
            return self._dense_search_fallback(query, docs, top_k=top_k)

        doc_map = {item.doc_id: item for item in docs}
        ids = [item.doc_id for item in docs]
        documents = [item.text for item in docs]
        metadatas = [
            {
                "doc_id": item.doc_id,
                "task_id": item.task_id,
                "task_title": item.task_title,
                "video_path": item.video_path,
                "start": item.start,
                "end": item.end,
                "source": item.source,
                "source_set": ",".join(item.source_set),
                "has_image": bool(item.image_path),
                "language": item.language,
                "image_path": item.image_path,
            }
            for item in docs
        ]
        embeddings = [self._embed_text(item.text) for item in docs]
        try:
            collection.upsert(ids=ids, documents=documents, metadatas=metadatas, embeddings=embeddings)
            query_embedding = self._embed_text(query)
            result = collection.query(query_embeddings=[query_embedding], n_results=max(1, top_k))
            result_ids = (result.get("ids") or [[]])[0] if isinstance(result, dict) else []
            distances = (result.get("distances") or [[]])[0] if isinstance(result, dict) else []
            hits: list[RetrievalHit] = []
            for idx, doc_id in enumerate(result_ids):
                doc = doc_map.get(str(doc_id))
                if doc is None:
                    continue
                distance = float(distances[idx]) if idx < len(distances) else 1.0
                score = max(0.0, min(1.0, 1.0 - distance))
                hits.append(
                    RetrievalHit(
                        doc_id=doc.doc_id,
                        task_id=doc.task_id,
                        task_title=doc.task_title,
                        text=doc.text,
                        video_path=doc.video_path,
                        start=doc.start,
                        end=doc.end,
                        source=doc.source,
                        source_set=list(doc.source_set),
                        image_path=doc.image_path,
                        dense_score=score,
                    )
                )
            if hits:
                return hits[: max(1, top_k)]
        except Exception:  # noqa: BLE001
            pass
        return self._dense_search_fallback(query, docs, top_k=top_k)

    def _dense_search_fallback(self, query: str, docs: list[EvidenceDocument], *, top_k: int) -> list[RetrievalHit]:
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
                    source_set=list(doc.source_set),
                    image_path=doc.image_path,
                    dense_score=score,
                )
            )
        scored.sort(key=lambda item: item.dense_score, reverse=True)
        return scored[: max(1, top_k)]

    def _sparse_search(self, query: str, docs: list[EvidenceDocument], *, top_k: int) -> list[RetrievalHit]:
        if self._sparse_db_path is not None:
            try:
                hits = self._sparse_search_by_sqlite(query, docs, top_k=top_k)
                if hits:
                    return hits
            except Exception:  # noqa: BLE001
                pass
        return self._sparse_search_fallback(query, docs, top_k=top_k)

    def _sparse_search_by_sqlite(self, query: str, docs: list[EvidenceDocument], *, top_k: int) -> list[RetrievalHit]:
        if self._sparse_db_path is None:
            return []
        with sqlite3.connect(self._sparse_db_path) as conn:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            self._rebuild_sparse_index(conn, docs)
            match_query = _to_fts_query(query)
            if not match_query:
                return []
            rows = conn.execute(
                """
                SELECT
                    d.doc_id,
                    d.task_id,
                    d.task_title,
                    d.video_path,
                    d.start,
                    d.end,
                    d.source,
                    d.source_set,
                    d.image_path,
                    d.text,
                    bm25(evidence_fts) AS rank_score
                FROM evidence_fts
                JOIN evidence_docs d ON d.doc_id = evidence_fts.doc_id
                WHERE evidence_fts MATCH ?
                ORDER BY rank_score ASC
                LIMIT ?
                """,
                (match_query, max(1, top_k)),
            ).fetchall()
        hits: list[RetrievalHit] = []
        for row in rows:
            raw_rank = float(row[10] if row[10] is not None else 0.0)
            sparse_score = 1.0 / (1.0 + abs(raw_rank))
            source_set = _parse_source_set(row[7])
            hits.append(
                RetrievalHit(
                    doc_id=str(row[0]),
                    task_id=str(row[1]),
                    task_title=str(row[2]),
                    text=str(row[9]),
                    video_path=str(row[3]),
                    start=float(row[4]),
                    end=float(row[5]),
                    source=str(row[6]),
                    source_set=source_set,
                    image_path=str(row[8]),
                    sparse_score=sparse_score,
                )
            )
        hits.sort(key=lambda item: item.sparse_score, reverse=True)
        return hits[: max(1, top_k)]

    @staticmethod
    def _rebuild_sparse_index(conn: sqlite3.Connection, docs: list[EvidenceDocument]) -> None:
        conn.execute("DELETE FROM evidence_fts")
        conn.execute("DELETE FROM evidence_docs")
        conn.executemany(
            """
            INSERT INTO evidence_docs (
                doc_id, task_id, task_title, video_path, start, end, source, source_set, image_path, text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    item.doc_id,
                    item.task_id,
                    item.task_title,
                    item.video_path,
                    float(item.start),
                    float(item.end),
                    item.source,
                    ",".join(item.source_set),
                    item.image_path,
                    item.text,
                )
                for item in docs
            ],
        )
        conn.executemany(
            "INSERT INTO evidence_fts (doc_id, text) VALUES (?, ?)",
            [(item.doc_id, item.text) for item in docs],
        )
        conn.commit()

    @staticmethod
    def _sparse_search_fallback(query: str, docs: list[EvidenceDocument], *, top_k: int) -> list[RetrievalHit]:
        scored: list[RetrievalHit] = []
        query_tokens = _tokenize(query)
        for doc in docs:
            text_tokens = _tokenize(doc.text)
            overlap = len(query_tokens & text_tokens) / max(1, len(query_tokens)) if query_tokens else 0.0
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
                    source_set=list(doc.source_set),
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
            text_tokens = _tokenize(hit.text)
            token_overlap = len(query_tokens & text_tokens) / max(1, len(query_tokens)) if query_tokens else 0.0
            dense_sim = _cosine_similarity(query_vector, _char_ngram_tf(hit.text))
            hit.rerank_score = min(1.0, 0.55 * dense_sim + 0.25 * hit.rrf_score + 0.2 * token_overlap)
            hit.final_score = hit.rerank_score
            reranked.append(hit)
        reranked.sort(key=lambda item: item.final_score, reverse=True)
        return reranked[: max(1, top_n)]

    def _embed_text(self, text: str) -> list[float]:
        tokens = list(_tokenize(text))
        if not tokens:
            return [0.0] * self._embedding_dim
        vector = [0.0] * self._embedding_dim
        for token in tokens:
            digest = hashlib.sha1(token.encode("utf-8"), usedforsecurity=False).digest()
            for i in range(0, len(digest), 2):
                index = ((digest[i] << 8) + digest[i + 1]) % self._embedding_dim
                vector[index] += 1.0
        norm = math.sqrt(sum(value * value for value in vector))
        if norm <= 0:
            return vector
        return [value / norm for value in vector]


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
        source_set=list(hit.source_set),
        image_path=hit.image_path,
        dense_score=hit.dense_score,
        sparse_score=hit.sparse_score,
        rrf_score=hit.rrf_score,
        rerank_score=hit.rerank_score,
        final_score=hit.final_score,
    )


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _tokenize(text: str) -> set[str]:
    tokens = {match.group(0).lower() for match in _TOKEN_PATTERN.finditer(text)}
    if tokens:
        return tokens
    return {text[i : i + 2] for i in range(max(0, len(text) - 1)) if text[i : i + 2].strip()}


def _to_fts_query(text: str) -> str:
    tokens = [token for token in _tokenize(text) if token.strip()]
    if not tokens:
        return ""
    quoted = [f"\"{token.replace('\"', '')}\"" for token in tokens[:24]]
    return " OR ".join(quoted)


def _parse_source_set(raw: object) -> list[str]:
    text = str(raw or "").strip()
    if not text:
        return ["audio"]
    parts = [item.strip() for item in text.split(",") if item.strip()]
    return parts or ["audio"]


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
