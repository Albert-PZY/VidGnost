from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class EvidenceDocument:
    doc_id: str
    task_id: str
    task_title: str
    video_path: str
    start: float
    end: float
    source: str
    text: str
    image_path: str = ""


@dataclass(slots=True)
class RetrievalHit:
    doc_id: str
    task_id: str
    task_title: str
    text: str
    video_path: str
    start: float
    end: float
    source: str
    image_path: str
    dense_score: float = 0.0
    sparse_score: float = 0.0
    rrf_score: float = 0.0
    rerank_score: float = 0.0
    final_score: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "task_id": self.task_id,
            "task_title": self.task_title,
            "text": self.text,
            "video_path": self.video_path,
            "start": self.start,
            "end": self.end,
            "source": self.source,
            "image_path": self.image_path,
            "dense_score": self.dense_score,
            "sparse_score": self.sparse_score,
            "rrf_score": self.rrf_score,
            "rerank_score": self.rerank_score,
            "final_score": self.final_score,
        }


@dataclass(slots=True)
class SearchResult:
    query_text: str
    dense_hits: list[RetrievalHit]
    sparse_hits: list[RetrievalHit]
    rrf_hits: list[RetrievalHit]
    rerank_hits: list[RetrievalHit]

    def to_debug_dict(self) -> dict[str, Any]:
        return {
            "query_text": self.query_text,
            "dense_hits": [item.to_dict() for item in self.dense_hits],
            "sparse_hits": [item.to_dict() for item in self.sparse_hits],
            "rrf_hits": [item.to_dict() for item in self.rrf_hits],
            "rerank_hits": [item.to_dict() for item in self.rerank_hits],
        }


@dataclass(slots=True)
class Citation:
    doc_id: str
    task_id: str
    task_title: str
    source: str
    start: float
    end: float
    text: str
    image_path: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "task_id": self.task_id,
            "task_title": self.task_title,
            "source": self.source,
            "start": self.start,
            "end": self.end,
            "text": self.text,
            "image_path": self.image_path,
        }
