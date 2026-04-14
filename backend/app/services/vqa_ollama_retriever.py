from __future__ import annotations

import asyncio
import hashlib
import re
import sqlite3
from pathlib import Path
from typing import Any

import orjson

from app.models import TaskRecord, TaskStatus
from app.services.ingestion import extract_video_frames
from app.services.vqa_model_runtime import VQAModelRuntime
from app.services.vqa_types import EvidenceDocument, RetrievalHit, SearchResult

_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_]+", re.UNICODE)
_DEFAULT_FRAME_INTERVAL_SECONDS = 10.0


class VQAOllamaRetriever:
    def __init__(
        self,
        *,
        task_store,
        storage_dir: str,
        model_runtime: VQAModelRuntime,
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
        self._model_runtime = model_runtime
        self._window_seconds = max(1.0, float(window_seconds))
        self._stride_seconds = max(0.5, float(stride_seconds))
        self._dense_top_k = max(1, int(dense_top_k))
        self._sparse_top_k = max(1, int(sparse_top_k))
        self._fused_top_k = max(1, int(fused_top_k))
        self._rerank_top_n = max(1, int(rerank_top_n))
        self._rrf_k = max(1, int(rrf_k))
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
                conn.execute("DROP TABLE IF EXISTS evidence_fts;")
                conn.execute("DROP TABLE IF EXISTS evidence_docs;")
                conn.execute(
                    """
                    CREATE TABLE evidence_docs (
                        doc_id TEXT PRIMARY KEY,
                        task_id TEXT NOT NULL,
                        task_title TEXT NOT NULL,
                        video_path TEXT NOT NULL,
                        start REAL NOT NULL,
                        end REAL NOT NULL,
                        source TEXT NOT NULL,
                        source_set TEXT NOT NULL,
                        image_path TEXT NOT NULL,
                        text TEXT NOT NULL,
                        visual_text TEXT NOT NULL,
                        retrieval_text TEXT NOT NULL
                    );
                    """
                )
                conn.execute(
                    """
                    CREATE VIRTUAL TABLE evidence_fts
                    USING fts5(doc_id UNINDEXED, retrieval_text);
                    """
                )
        except Exception:  # noqa: BLE001
            self._sparse_db_path = None

    async def search(
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
        frame_interval_seconds = self._resolve_frame_interval_seconds()
        documents = await self._collect_documents(
            task_id=task_id,
            video_paths=video_paths,
            frame_interval_seconds=frame_interval_seconds,
        )
        if not documents:
            return SearchResult(query_text=query, dense_hits=[], sparse_hits=[], rrf_hits=[], rerank_hits=[])
        max_top_k = max(1, int(top_k or self._rerank_top_n))
        rerank_candidate_k = max(max_top_k, min(self._fused_top_k, max(max_top_k * 2, 12)))
        dense_hits = self._dedupe_hits(
            await self._dense_search(query, documents, top_k=max(self._dense_top_k, max_top_k)),
            primary_score_key="dense_score",
        )
        sparse_hits = self._dedupe_hits(
            self._sparse_search(query, documents, top_k=max(self._sparse_top_k, max_top_k)),
            primary_score_key="sparse_score",
        )
        rrf_hits = self._dedupe_hits(
            self._rrf_fusion(dense_hits, sparse_hits, top_k=rerank_candidate_k),
            primary_score_key="rrf_score",
        )
        rerank_hits = self._dedupe_hits(
            await self._rerank(query, rrf_hits, top_n=max_top_k),
            primary_score_key="final_score",
        )
        rerank_hits = await self._hydrate_visual_hits(
            rerank_hits,
            frame_interval_seconds=frame_interval_seconds,
        )
        rerank_hits = self._dedupe_hits(
            await self._rerank(query, rerank_hits, top_n=max_top_k),
            primary_score_key="final_score",
        )
        return SearchResult(
            query_text=query,
            dense_hits=dense_hits,
            sparse_hits=sparse_hits,
            rrf_hits=rrf_hits,
            rerank_hits=rerank_hits,
        )

    async def _collect_documents(
        self,
        *,
        task_id: str | None,
        video_paths: list[str] | None,
        frame_interval_seconds: float,
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
            if record.status not in {TaskStatus.COMPLETED.value, TaskStatus.FAILED.value, TaskStatus.CANCELLED.value}:
                continue
            docs.extend(await self._build_documents_from_task(record, frame_interval_seconds=frame_interval_seconds))
        return docs

    async def _build_documents_from_task(self, record: TaskRecord, *, frame_interval_seconds: float) -> list[EvidenceDocument]:
        segments = _parse_transcript_segments(record)
        if not segments:
            return []
        max_end = max(end for _, end, _ in segments)
        if max_end <= 0:
            return []
        frame_assets = await self._ensure_frame_assets(
            record,
            frame_interval_seconds=frame_interval_seconds,
            describe_missing=False,
        )
        docs: list[EvidenceDocument] = []
        cursor = 0.0
        seen_keys: set[str] = set()
        window_seconds = max(2.0, float(frame_interval_seconds or self._window_seconds))
        stride_seconds = max(1.0, float(frame_interval_seconds or self._stride_seconds))
        while cursor <= max_end + 1e-6:
            start = round(cursor, 3)
            end = round(min(max_end, start + window_seconds), 3)
            window_parts = [
                text.strip()
                for seg_start, seg_end, text in segments
                if text.strip() and seg_end > start and seg_start < end
            ]
            if not window_parts:
                cursor += stride_seconds
                continue
            text = " ".join(window_parts).strip()
            frame_asset = _select_frame_asset(frame_assets, start=start, end=end)
            image_path = str(frame_asset.get("relative_path", "")).strip() if frame_asset else ""
            visual_text = str(frame_asset.get("visual_text", "")).strip() if frame_asset else ""
            retrieval_text = _compose_retrieval_text(text=text, visual_text=visual_text)
            dedupe_key = _normalize_retrieval_text(retrieval_text)
            if dedupe_key in seen_keys:
                cursor += stride_seconds
                continue
            seen_keys.add(dedupe_key)
            source_set = ["audio"] + (["visual"] if image_path else [])
            docs.append(
                EvidenceDocument(
                    doc_id=_build_doc_id(record=record, start=start, end=end, source_set=source_set, image_path=image_path, text=text, visual_text=visual_text),
                    task_id=record.id,
                    task_title=(record.title or record.id).strip() or record.id,
                    video_path=str(record.source_local_path or record.source_input or ""),
                    start=start,
                    end=end,
                    source="+".join(source_set),
                    text=text,
                    visual_text=visual_text,
                    image_path=image_path,
                    language=(record.language or "unknown").strip() or "unknown",
                    source_set=source_set,
                )
            )
            cursor += stride_seconds
        return docs

    async def _ensure_frame_assets(
        self,
        record: TaskRecord,
        *,
        frame_interval_seconds: float,
        describe_missing: bool,
        only_relative_paths: list[str] | None = None,
    ) -> list[dict[str, object]]:
        media_path = Path(str(record.source_local_path or record.source_input or "")).expanduser()
        if not media_path.is_file():
            return []
        frames_dir = self._storage_dir / "tasks" / "stage-artifacts" / record.id / "D" / "fusion" / "frames"
        manifest_path = frames_dir / "index.json"
        assets = _load_frame_manifest(manifest_path, frame_interval_seconds=frame_interval_seconds)
        if not assets:
            assets = _load_existing_frame_assets(frames_dir, frame_interval_seconds=frame_interval_seconds)
        if not assets:
            extracted = await asyncio.to_thread(
                extract_video_frames,
                media_path,
                frames_dir,
                interval_seconds=frame_interval_seconds,
            )
            assets = [
                {
                    "timestamp": round(index * frame_interval_seconds, 3),
                    "relative_path": f"frames/{frame_path.name}",
                    "visual_text": "",
                }
                for index, frame_path in enumerate(extracted)
                if frame_path.is_file()
            ]
        target_relative_paths = {
            str(item).strip()
            for item in (only_relative_paths or [])
            if str(item).strip()
        }
        if describe_missing:
            missing_indexes = [
                index
                for index, asset in enumerate(assets)
                if (
                    (not target_relative_paths or str(asset.get("relative_path", "")).strip() in target_relative_paths)
                    and not str(asset.get("visual_text", "")).strip()
                )
            ]
            if missing_indexes:
                absolute_paths = [
                    str((manifest_path.parent.parent / str(assets[index]["relative_path"])).resolve())
                    for index in missing_indexes
                ]
                descriptions = await self._model_runtime.describe_images(absolute_paths)
                for index, description in zip(missing_indexes, descriptions, strict=False):
                    assets[index]["visual_text"] = description
        if assets:
            _write_frame_manifest(manifest_path, frame_interval_seconds=frame_interval_seconds, assets=assets)
        return assets

    async def _hydrate_visual_hits(
        self,
        hits: list[RetrievalHit],
        *,
        frame_interval_seconds: float,
    ) -> list[RetrievalHit]:
        if not hits:
            return []
        grouped_paths: dict[str, set[str]] = {}
        for hit in hits:
            if not hit.image_path:
                continue
            grouped_paths.setdefault(hit.task_id, set()).add(hit.image_path)
        if not grouped_paths:
            return hits
        record_map = {
            record.id: record
            for record in self._task_store.list_all()
            if record.id in grouped_paths
        }
        hydrated_visual_text: dict[tuple[str, str], str] = {}
        for task_id, image_paths in grouped_paths.items():
            record = record_map.get(task_id)
            if record is None:
                continue
            assets = await self._ensure_frame_assets(
                record,
                frame_interval_seconds=frame_interval_seconds,
                describe_missing=True,
                only_relative_paths=sorted(image_paths),
            )
            for asset in assets:
                relative_path = str(asset.get("relative_path", "")).strip()
                if relative_path and relative_path in image_paths:
                    hydrated_visual_text[(task_id, relative_path)] = str(asset.get("visual_text", "")).strip()
        result: list[RetrievalHit] = []
        for hit in hits:
            item = _clone_hit(hit)
            if not item.visual_text and item.image_path:
                item.visual_text = hydrated_visual_text.get((item.task_id, item.image_path), "")
            result.append(item)
        return result

    def _resolve_frame_interval_seconds(self) -> float:
        catalog_path = self._storage_dir / "models" / "catalog.json"
        if not catalog_path.exists():
            return _DEFAULT_FRAME_INTERVAL_SECONDS
        try:
            payload = orjson.loads(catalog_path.read_bytes())
        except (orjson.JSONDecodeError, OSError):
            return _DEFAULT_FRAME_INTERVAL_SECONDS
        if not isinstance(payload, list):
            return _DEFAULT_FRAME_INTERVAL_SECONDS
        for item in payload:
            if isinstance(item, dict) and str(item.get("id", "")).strip() == "vlm-default":
                return max(1.0, float(item.get("frame_interval_seconds", _DEFAULT_FRAME_INTERVAL_SECONDS) or _DEFAULT_FRAME_INTERVAL_SECONDS))
        return _DEFAULT_FRAME_INTERVAL_SECONDS

    async def _dense_search(self, query: str, docs: list[EvidenceDocument], *, top_k: int) -> list[RetrievalHit]:
        retrieval_texts = [_compose_retrieval_text(text=item.text, visual_text=item.visual_text) for item in docs]
        doc_embeddings = await self._model_runtime.embed_texts(retrieval_texts)
        query_embedding = (await self._model_runtime.embed_texts([query]))[0]
        if self._chroma_enabled and self._chroma_collection is not None:
            try:
                return self._dense_search_by_chroma(query_embedding=query_embedding, docs=docs, doc_embeddings=doc_embeddings, top_k=top_k)
            except Exception:  # noqa: BLE001
                pass
        scored = [_doc_to_hit(doc, dense_score=_cosine_similarity(query_embedding, emb)) for doc, emb in zip(docs, doc_embeddings, strict=False)]
        scored.sort(key=lambda item: item.dense_score, reverse=True)
        return scored[: max(1, top_k)]

    def _dense_search_by_chroma(
        self,
        *,
        query_embedding: list[float],
        docs: list[EvidenceDocument],
        doc_embeddings: list[list[float]],
        top_k: int,
    ) -> list[RetrievalHit]:
        collection = self._chroma_collection
        if collection is None:
            return []
        doc_map = {item.doc_id: item for item in docs}
        collection.upsert(
            ids=[item.doc_id for item in docs],
            documents=[_compose_retrieval_text(text=item.text, visual_text=item.visual_text) for item in docs],
            metadatas=[
                {
                    "doc_id": item.doc_id,
                    "task_id": item.task_id,
                    "task_title": item.task_title,
                    "image_path": item.image_path,
                    "visual_text": item.visual_text,
                    "start": item.start,
                    "end": item.end,
                    "source": item.source,
                    "source_set": ",".join(item.source_set),
                }
                for item in docs
            ],
            embeddings=doc_embeddings,
        )
        result = collection.query(query_embeddings=[query_embedding], n_results=max(1, top_k))
        result_ids = (result.get("ids") or [[]])[0] if isinstance(result, dict) else []
        distances = (result.get("distances") or [[]])[0] if isinstance(result, dict) else []
        hits: list[RetrievalHit] = []
        for index, doc_id in enumerate(result_ids):
            doc = doc_map.get(str(doc_id))
            if doc is None:
                continue
            distance = float(distances[index]) if index < len(distances) else 1.0
            hits.append(_doc_to_hit(doc, dense_score=1.0 / (1.0 + max(0.0, distance))))
        return hits[: max(1, top_k)]

    def _sparse_search(self, query: str, docs: list[EvidenceDocument], *, top_k: int) -> list[RetrievalHit]:
        if self._sparse_db_path is not None:
            try:
                hits = self._sparse_search_by_sqlite(query, docs, top_k=top_k)
                if hits:
                    return hits
            except Exception:  # noqa: BLE001
                pass
        query_tokens = _tokenize(query)
        scored: list[RetrievalHit] = []
        for doc in docs:
            retrieval_text = _compose_retrieval_text(text=doc.text, visual_text=doc.visual_text)
            tokens = _tokenize(retrieval_text)
            overlap = len(query_tokens & tokens) / max(1, len(query_tokens)) if query_tokens else 0.0
            contains_bonus = 0.15 if query.strip().lower() in retrieval_text.lower() else 0.0
            scored.append(_doc_to_hit(doc, sparse_score=min(1.0, overlap + contains_bonus)))
        scored.sort(key=lambda item: item.sparse_score, reverse=True)
        return scored[: max(1, top_k)]

    def _sparse_search_by_sqlite(self, query: str, docs: list[EvidenceDocument], *, top_k: int) -> list[RetrievalHit]:
        if self._sparse_db_path is None:
            return []
        with sqlite3.connect(self._sparse_db_path) as conn:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            _rebuild_sparse_index(conn, docs)
            match_query = _to_fts_query(query)
            if not match_query:
                return []
            rows = conn.execute(
                """
                SELECT d.doc_id, d.task_id, d.task_title, d.video_path, d.start, d.end, d.source, d.source_set, d.image_path, d.text, d.visual_text, bm25(evidence_fts) AS rank_score
                FROM evidence_fts
                JOIN evidence_docs d ON d.doc_id = evidence_fts.doc_id
                WHERE evidence_fts MATCH ?
                ORDER BY rank_score ASC
                LIMIT ?
                """,
                (match_query, max(1, top_k)),
            ).fetchall()
        normalized_scores = _normalize_sparse_rank_scores([float(row[11] if row[11] is not None else 0.0) for row in rows])
        hits: list[RetrievalHit] = []
        query_tokens = _tokenize(query)
        for row, sparse_score in zip(rows, normalized_scores, strict=False):
            retrieval_text = _compose_retrieval_text(text=str(row[9]), visual_text=str(row[10]))
            overlap = 0.0
            if query_tokens:
                overlap = len(query_tokens & _tokenize(retrieval_text)) / max(1, len(query_tokens))
            hits.append(
                RetrievalHit(
                    doc_id=str(row[0]),
                    task_id=str(row[1]),
                    task_title=str(row[2]),
                    text=str(row[9]),
                    visual_text=str(row[10]),
                    video_path=str(row[3]),
                    start=float(row[4]),
                    end=float(row[5]),
                    source=str(row[6]),
                    source_set=_parse_source_set(row[7]),
                    image_path=str(row[8]),
                    sparse_score=max(0.01, float(sparse_score), float(overlap)),
                )
            )
        hits.sort(key=lambda item: item.sparse_score, reverse=True)
        return hits[: max(1, top_k)]

    def _rrf_fusion(self, dense_hits: list[RetrievalHit], sparse_hits: list[RetrievalHit], *, top_k: int) -> list[RetrievalHit]:
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

    async def _rerank(self, query: str, hits: list[RetrievalHit], *, top_n: int) -> list[RetrievalHit]:
        if not hits:
            return []
        rerank_inputs = [_compose_retrieval_text(text=item.text, visual_text=item.visual_text) for item in hits]
        scores = await self._model_runtime.score_rerank_pairs(query=query, documents=rerank_inputs)
        ranked: list[RetrievalHit] = []
        for hit, score in zip(hits, scores, strict=False):
            item = _clone_hit(hit)
            item.rerank_score = max(0.0, min(1.0, float(score)))
            item.final_score = item.rerank_score
            ranked.append(item)
        ranked.sort(key=lambda item: item.final_score, reverse=True)
        return ranked[: max(1, top_n)]

    def _dedupe_hits(self, hits: list[RetrievalHit], *, primary_score_key: str) -> list[RetrievalHit]:
        deduped: list[RetrievalHit] = []
        index_by_key: dict[str, int] = {}
        for hit in hits:
            key = f"{hit.task_id}|{_normalize_retrieval_text(_compose_retrieval_text(text=hit.text, visual_text=hit.visual_text))}"
            existing_index = index_by_key.get(key)
            if existing_index is None:
                deduped.append(_clone_hit(hit))
                index_by_key[key] = len(deduped) - 1
                continue
            current = deduped[existing_index]
            preferred = hit if _read_hit_score(hit, primary_score_key) > _read_hit_score(current, primary_score_key) else current
            merged = _clone_hit(preferred)
            merged.source_set = _merge_source_sets(current.source_set, hit.source_set)
            merged.source = "+".join(merged.source_set)
            merged.image_path = merged.image_path or current.image_path or hit.image_path
            merged.visual_text = merged.visual_text or current.visual_text or hit.visual_text
            merged.dense_score = max(current.dense_score, hit.dense_score)
            merged.sparse_score = max(current.sparse_score, hit.sparse_score)
            merged.rrf_score = max(current.rrf_score, hit.rrf_score)
            merged.rerank_score = max(current.rerank_score, hit.rerank_score)
            merged.final_score = max(current.final_score, hit.final_score)
            deduped[existing_index] = merged
        return deduped


def _doc_to_hit(doc: EvidenceDocument, *, dense_score: float = 0.0, sparse_score: float = 0.0) -> RetrievalHit:
    return RetrievalHit(
        doc_id=doc.doc_id,
        task_id=doc.task_id,
        task_title=doc.task_title,
        text=doc.text,
        visual_text=doc.visual_text,
        video_path=doc.video_path,
        start=doc.start,
        end=doc.end,
        source=doc.source,
        source_set=list(doc.source_set),
        image_path=doc.image_path,
        dense_score=dense_score,
        sparse_score=sparse_score,
    )


def _clone_hit(hit: RetrievalHit) -> RetrievalHit:
    return RetrievalHit(
        doc_id=hit.doc_id,
        task_id=hit.task_id,
        task_title=hit.task_title,
        text=hit.text,
        visual_text=hit.visual_text,
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


def _build_doc_id(
    *,
    record: TaskRecord,
    start: float,
    end: float,
    source_set: list[str],
    image_path: str,
    text: str,
    visual_text: str,
) -> str:
    raw = f"{record.id}|{start:.3f}|{end:.3f}|{'+'.join(source_set)}|{image_path}|{text}|{visual_text}"
    return hashlib.sha1(raw.encode("utf-8"), usedforsecurity=False).hexdigest()


def _parse_transcript_segments(record: TaskRecord) -> list[tuple[float, float, str]]:
    if (record.transcript_segments_json or "").strip():
        try:
            payload = orjson.loads(record.transcript_segments_json or "[]")
        except orjson.JSONDecodeError:
            payload = []
        if isinstance(payload, list):
            parsed: list[tuple[float, float, str]] = []
            for item in payload:
                if not isinstance(item, dict):
                    continue
                start = _to_float(item.get("start"))
                end = max(start, _to_float(item.get("end")))
                text = str(item.get("text", "")).strip()
                if text:
                    parsed.append((start, end, text))
            if parsed:
                return parsed
    text = (record.transcript_text or "").strip()
    if not text:
        return []
    chunks = [line.strip() for line in text.splitlines() if line.strip()]
    cursor = 0.0
    parsed: list[tuple[float, float, str]] = []
    for chunk in chunks:
        parsed.append((cursor, cursor + 3.0, chunk))
        cursor += 3.0
    return parsed


def _load_frame_manifest(manifest_path: Path, *, frame_interval_seconds: float) -> list[dict[str, object]]:
    if not manifest_path.exists():
        return []
    try:
        payload = orjson.loads(manifest_path.read_bytes())
    except (orjson.JSONDecodeError, OSError):
        return []
    if not isinstance(payload, dict):
        return []
    manifest_interval = _to_float(payload.get("frame_interval_seconds"))
    if abs(manifest_interval - frame_interval_seconds) > 1e-6:
        return []
    raw_frames = payload.get("frames")
    if not isinstance(raw_frames, list):
        return []
    assets: list[dict[str, object]] = []
    for item in raw_frames:
        if not isinstance(item, dict):
            continue
        relative_path = str(item.get("relative_path", "")).strip()
        if not relative_path:
            continue
        assets.append(
            {
                "timestamp": round(_to_float(item.get("timestamp")), 3),
                "relative_path": relative_path,
                "visual_text": str(item.get("visual_text", "")).strip(),
            }
        )
    return assets


def _load_existing_frame_assets(frames_dir: Path, *, frame_interval_seconds: float) -> list[dict[str, object]]:
    frame_paths = sorted(frames_dir.glob("frame-*.jpg"))
    if not frame_paths:
        return []
    return [
        {
            "timestamp": round(index * frame_interval_seconds, 3),
            "relative_path": f"frames/{frame_path.name}",
            "visual_text": "",
        }
        for index, frame_path in enumerate(frame_paths)
        if frame_path.is_file()
    ]


def _write_frame_manifest(manifest_path: Path, *, frame_interval_seconds: float, assets: list[dict[str, object]]) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_bytes(
        orjson.dumps(
            {
                "frame_interval_seconds": round(frame_interval_seconds, 3),
                "frame_count": len(assets),
                "frames": assets,
            },
            option=orjson.OPT_INDENT_2,
        )
    )


def _select_frame_asset(assets: list[dict[str, object]], *, start: float, end: float) -> dict[str, object] | None:
    if not assets:
        return None
    midpoint = (start + end) / 2.0
    return min(assets, key=lambda item: abs(_to_float(item.get("timestamp")) - midpoint))


def _compose_retrieval_text(*, text: str, visual_text: str) -> str:
    transcript = str(text).strip()
    vision = str(visual_text).strip()
    if transcript and vision:
        return f"{transcript}\n视觉线索：{vision}"
    return transcript or vision


def _rebuild_sparse_index(conn: sqlite3.Connection, docs: list[EvidenceDocument]) -> None:
    conn.execute("DELETE FROM evidence_fts")
    conn.execute("DELETE FROM evidence_docs")
    conn.executemany(
        """
        INSERT INTO evidence_docs (doc_id, task_id, task_title, video_path, start, end, source, source_set, image_path, text, visual_text, retrieval_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                item.visual_text,
                _compose_retrieval_text(text=item.text, visual_text=item.visual_text),
            )
            for item in docs
        ],
    )
    conn.executemany(
        "INSERT INTO evidence_fts (doc_id, retrieval_text) VALUES (?, ?)",
        [(item.doc_id, _compose_retrieval_text(text=item.text, visual_text=item.visual_text)) for item in docs],
    )
    conn.commit()


def _read_hit_score(hit: RetrievalHit, score_key: str) -> float:
    try:
        return float(getattr(hit, score_key))
    except (AttributeError, TypeError, ValueError):
        return 0.0


def _normalize_sparse_rank_scores(raw_scores: list[float]) -> list[float]:
    if not raw_scores:
        return []
    low = min(raw_scores)
    high = max(raw_scores)
    if abs(high - low) <= 1e-9:
        return [1.0 for _ in raw_scores]
    return [1.0 - ((score - low) / (high - low)) for score in raw_scores]


def _merge_source_sets(*source_sets: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for source_values in source_sets:
        for value in source_values:
            candidate = str(value).strip()
            if candidate and candidate not in seen:
                seen.add(candidate)
                merged.append(candidate)
    return merged or ["audio"]


def _parse_source_set(raw: object) -> list[str]:
    text = str(raw or "").strip()
    if not text:
        return ["audio"]
    parts = [item.strip() for item in text.split(",") if item.strip()]
    return parts or ["audio"]


def _tokenize(text: str) -> set[str]:
    tokens = {match.group(0).lower() for match in _TOKEN_PATTERN.finditer(text)}
    if tokens:
        return tokens
    return {text[index : index + 2] for index in range(max(0, len(text) - 1)) if text[index : index + 2].strip()}


def _to_fts_query(text: str) -> str:
    tokens = [token for token in _tokenize(text) if token.strip()]
    return " OR ".join(f"\"{token.replace('\"', '')}\"" for token in tokens[:24])


def _normalize_retrieval_text(text: str) -> str:
    return " ".join(str(text or "").split()).strip().lower()


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    numerator = sum(float(a) * float(b) for a, b in zip(left, right, strict=False))
    left_norm = sum(float(value) * float(value) for value in left) ** 0.5
    right_norm = sum(float(value) * float(value) for value in right) ** 0.5
    if left_norm <= 0 or right_norm <= 0:
        return 0.0
    return max(0.0, min(1.0, numerator / (left_norm * right_norm)))
