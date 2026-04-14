from __future__ import annotations

from dataclasses import dataclass
from typing import Any, AsyncIterator

from app.services.developer_log_service import DeveloperLogService
from app.services.llm_config_store import LLMConfigStore
from app.services.model_catalog_store import ModelCatalogStore
from app.services.ollama_client import OllamaClient
from app.services.task_store import TaskStore
from app.services.vqa_chat_service import ChatResult, VQAChatService
from app.services.vqa_model_runtime import VQAModelRuntime
from app.services.vqa_ollama_retriever import VQAOllamaRetriever
from app.services.vqa_trace_store import VQATraceStore
from app.services.vqa_types import SearchResult


@dataclass(slots=True)
class SearchBundle:
    trace_id: str
    result: SearchResult


@dataclass(slots=True)
class AnalyzeBundle:
    trace_id: str
    search: SearchResult
    chat: ChatResult


class VQARuntimeService:
    def __init__(
        self,
        *,
        task_store: TaskStore,
        llm_config_store: LLMConfigStore,
        model_catalog_store: ModelCatalogStore | None = None,
        model_runtime: VQAModelRuntime | None = None,
        storage_dir: str,
        developer_log_service: DeveloperLogService | None = None,
    ) -> None:
        resolved_model_catalog_store = model_catalog_store or ModelCatalogStore(
            llm_config_store._settings,  # type: ignore[attr-defined]
            ollama_client=OllamaClient(llm_config_store._settings),  # type: ignore[attr-defined]
        )
        resolved_model_runtime = model_runtime or VQAModelRuntime(
            model_catalog_store=resolved_model_catalog_store,
            ollama_client=OllamaClient(llm_config_store._settings),  # type: ignore[attr-defined]
            storage_dir=storage_dir,
        )
        self._retriever = VQAOllamaRetriever(
            task_store=task_store,
            storage_dir=storage_dir,
            model_runtime=resolved_model_runtime,
        )
        self._chat = VQAChatService(
            llm_config_store=llm_config_store,
            model_catalog_store=resolved_model_catalog_store,
            model_runtime=resolved_model_runtime,
        )
        self._model_catalog_store = resolved_model_catalog_store
        self._trace = VQATraceStore(log_dir=f"{storage_dir}/event-logs/traces")
        self._developer_log_service = developer_log_service

    def read_trace(self, trace_id: str) -> list[dict[str, Any]]:
        return self._trace.read_trace(trace_id)

    async def _publish_log(
        self,
        *,
        level: str,
        message: str,
        task_id: str | None = None,
        trace_id: str | None = None,
        stage: str | None = None,
        event_type: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        if self._developer_log_service is None:
            return
        await self._developer_log_service.publish(
            category="vqa",
            level=level,
            source="services.vqa_runtime",
            message=message,
            task_id=task_id,
            trace_id=trace_id,
            stage=stage,
            event_type=event_type,
            payload=payload or {},
        )

    async def prewarm_task(self, *, task_id: str, force: bool = False) -> dict[str, object]:
        return await self._retriever.prewarm_task(task_id=task_id, force=force)

    async def search(
        self,
        *,
        query_text: str,
        task_id: str | None = None,
        video_paths: list[str] | None = None,
        top_k: int | None = None,
        trace_id: str | None = None,
    ) -> SearchBundle:
        resolved_top_k = max(1, int(top_k or self._model_catalog_store.get_rerank_top_n()))
        resolved_trace_id = trace_id or self._trace.new_trace(
            metadata={
                "query_text": query_text,
                "task_id": task_id,
                "video_paths": video_paths or [],
                "top_k": resolved_top_k,
            },
            config_snapshot={
                "retrieval": {
                    "mode": "hybrid",
                    "rrf": True,
                    "rerank": True,
                    "query_expansion": False,
                    "dedupe": "same-task-same-text",
                    "rerank_top_n": resolved_top_k,
                }
            },
        )
        await self._publish_log(
            level="info",
            message="开始执行视频问答检索。",
            task_id=task_id,
            trace_id=resolved_trace_id,
            stage="retrieval",
            event_type="vqa_retrieval_start",
            payload={
                "query_text": query_text,
                "task_id": task_id,
                "video_paths": video_paths or [],
                "top_k": resolved_top_k,
            },
        )
        result = await self._retriever.search(
            query_text=query_text,
            task_id=task_id,
            video_paths=video_paths,
            top_k=resolved_top_k,
        )
        self._trace.write(
            trace_id=resolved_trace_id,
            stage="retrieval",
            payload={
                "query_text": query_text,
                "task_id": task_id,
                "video_paths": video_paths or [],
                "top_k": resolved_top_k,
                "query_expansion": False,
                "dedupe": "same-task-same-text",
                "dense_hits": [item.to_dict() for item in result.dense_hits],
                "sparse_hits": [item.to_dict() for item in result.sparse_hits],
                "rrf_hits": [item.to_dict() for item in result.rrf_hits],
                "rerank_hits": [item.to_dict() for item in result.rerank_hits],
            },
        )
        await self._publish_log(
            level="info" if result.rerank_hits else "warning",
            message=f"检索完成，获得 {len(result.rerank_hits)} 条最终候选。",
            task_id=task_id,
            trace_id=resolved_trace_id,
            stage="retrieval",
            event_type="vqa_retrieval_complete",
            payload={
                "dense_count": len(result.dense_hits),
                "sparse_count": len(result.sparse_hits),
                "rrf_count": len(result.rrf_hits),
                "rerank_count": len(result.rerank_hits),
            },
        )
        return SearchBundle(trace_id=resolved_trace_id, result=result)

    async def analyze(
        self,
        *,
        query_text: str,
        task_id: str | None = None,
        video_paths: list[str] | None = None,
        top_k: int | None = None,
    ) -> AnalyzeBundle:
        search_bundle = await self.search(
            query_text=query_text,
            task_id=task_id,
            video_paths=video_paths,
            top_k=top_k,
        )
        await self._publish_log(
            level="info",
            message="开始生成问答结果。",
            task_id=task_id,
            trace_id=search_bundle.trace_id,
            stage="generation",
            event_type="vqa_generation_start",
            payload={"hit_count": len(search_bundle.result.rerank_hits)},
        )
        chat_result = await self._chat.answer(query_text=query_text, hits=search_bundle.result.rerank_hits)
        self._trace.write(
            trace_id=search_bundle.trace_id,
            stage="llm_completion",
            payload={
                "error": chat_result.error,
                "context_tokens_approx": chat_result.context_tokens_approx,
                "citation_count": len(chat_result.citations),
                "answer_preview": chat_result.answer[:800],
            },
        )
        self._trace.finalize(
            trace_id=search_bundle.trace_id,
            payload={
                "ok": chat_result.error is None,
                "result_count": len(search_bundle.result.rerank_hits),
                "citation_count": len(chat_result.citations),
            },
        )
        await self._publish_log(
            level="error" if chat_result.error else "info",
            message="问答结果生成完成。",
            task_id=task_id,
            trace_id=search_bundle.trace_id,
            stage="generation",
            event_type="vqa_generation_complete",
            payload={
                "error": chat_result.error,
                "citation_count": len(chat_result.citations),
                "context_tokens_approx": chat_result.context_tokens_approx,
            },
        )
        return AnalyzeBundle(trace_id=search_bundle.trace_id, search=search_bundle.result, chat=chat_result)

    async def stream_chat(
        self,
        *,
        query_text: str,
        task_id: str | None = None,
        video_paths: list[str] | None = None,
        top_k: int | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        yield {"type": "status", "status": "retrieving"}
        search_bundle = await self.search(
            query_text=query_text,
            task_id=task_id,
            video_paths=video_paths,
            top_k=top_k,
        )
        await self._publish_log(
            level="info",
            message="开始流式生成问答结果。",
            task_id=task_id,
            trace_id=search_bundle.trace_id,
            stage="llm_stream",
            event_type="vqa_stream_start",
            payload={"hit_count": len(search_bundle.result.rerank_hits)},
        )
        yield {
            "trace_id": search_bundle.trace_id,
            "type": "status",
            "status": "generating",
            "hit_count": len(search_bundle.result.rerank_hits),
        }
        full_answer: list[str] = []
        stream_error: dict[str, str] | None = None
        async for event in self._chat.stream_answer(query_text=query_text, hits=search_bundle.result.rerank_hits):
            if event.get("type") == "chunk":
                delta = str(event.get("delta", ""))
                if delta:
                    full_answer.append(delta)
            if event.get("type") == "error":
                payload = event.get("error")
                if isinstance(payload, dict):
                    stream_error = {
                        "code": str(payload.get("code", "LLM_STREAM_ERROR")),
                        "message": str(payload.get("message", "stream failed")),
                    }
                continue
            outbound = {"trace_id": search_bundle.trace_id, **event}
            yield outbound

        if stream_error is not None:
            # Auto downgrade to non-stream completion.
            await self._publish_log(
                level="warning",
                message="流式生成中断，准备回退到非流式补全。",
                task_id=task_id,
                trace_id=search_bundle.trace_id,
                stage="llm_stream",
                event_type="vqa_stream_fallback",
                payload={"error": stream_error},
            )
            fallback = await self._chat.answer(query_text=query_text, hits=search_bundle.result.rerank_hits)
            if fallback.answer:
                yield {
                    "trace_id": search_bundle.trace_id,
                    "type": "status",
                    "status": "fallback",
                    "hit_count": len(search_bundle.result.rerank_hits),
                }
                yield {
                    "trace_id": search_bundle.trace_id,
                    "type": "replace",
                    "content": fallback.answer,
                }
                full_answer = [fallback.answer]
                stream_error = fallback.error
            else:
                fallback_error = fallback.error or stream_error
                yield {
                    "trace_id": search_bundle.trace_id,
                    "type": "error",
                    "error": _build_user_visible_stream_error(fallback_error),
                }

        answer_text = "".join(full_answer).strip()
        self._trace.write(
            trace_id=search_bundle.trace_id,
            stage="llm_stream",
            payload={
                "error": stream_error,
                "answer_preview": answer_text[:800],
                "citation_count": len(search_bundle.result.rerank_hits),
            },
        )
        self._trace.finalize(
            trace_id=search_bundle.trace_id,
            payload={
                "ok": stream_error is None,
                "result_count": len(search_bundle.result.rerank_hits),
                "answer_size": len(answer_text),
            },
        )
        await self._publish_log(
            level="error" if stream_error else "info",
            message="流式问答已结束。",
            task_id=task_id,
            trace_id=search_bundle.trace_id,
            stage="llm_stream",
            event_type="vqa_stream_complete",
            payload={
                "error": stream_error,
                "answer_size": len(answer_text),
                "result_count": len(search_bundle.result.rerank_hits),
            },
        )

    def build_search_payload(self, bundle: SearchBundle) -> dict[str, Any]:
        return {
            "trace_id": bundle.trace_id,
            "query_text": bundle.result.query_text,
            **bundle.result.to_debug_dict(),
            "hits": [item.to_dict() for item in bundle.result.rerank_hits],
        }

    def build_analyze_payload(self, bundle: AnalyzeBundle) -> dict[str, Any]:
        return {
            "trace_id": bundle.trace_id,
            "query_text": bundle.search.query_text,
            "retrieval": bundle.search.to_debug_dict(),
            "hits": [item.to_dict() for item in bundle.search.rerank_hits],
            "chat": bundle.chat.to_dict(),
        }

    def build_trace_payload(self, trace_id: str) -> dict[str, Any]:
        return {"trace_id": trace_id, "records": self.read_trace(trace_id)}


def _build_user_visible_stream_error(error: dict[str, str] | None) -> dict[str, str]:
    payload = error or {"code": "LLM_STREAM_ERROR", "message": "stream failed"}
    raw_code = str(payload.get("code", "LLM_STREAM_ERROR") or "LLM_STREAM_ERROR").strip() or "LLM_STREAM_ERROR"
    raw_message = str(payload.get("message", "") or "").strip()
    lowered = raw_message.lower()

    if raw_code == "LLM_DISABLED":
        return {
            "code": raw_code,
            "message": "LLM API Key 未配置，暂时无法执行流式问答。",
        }

    if "incomplete chunked read" in lowered or "peer closed connection" in lowered:
        return {
            "code": "LLM_STREAM_INTERRUPTED",
            "message": "流式连接中途中断，系统未能完成自动恢复，请稍后重试。",
        }

    return {
        "code": raw_code,
        "message": raw_message or "流式回答失败，请稍后重试。",
    }
