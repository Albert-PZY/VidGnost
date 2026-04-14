from __future__ import annotations

import orjson
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.errors import AppError
from app.schemas import VQAAnalyzeRequest, VQAChatRequest, VQASearchRequest
from app.services.vqa_runtime_service import VQARuntimeService

router = APIRouter(tags=["vqa"])


def get_vqa_runtime(request: Request) -> VQARuntimeService:
    return request.app.state.vqa_runtime


@router.post("/analyze")
async def analyze(
    payload: VQAAnalyzeRequest,
    runtime: VQARuntimeService = Depends(get_vqa_runtime),
) -> dict[str, object]:
    query_text = _resolve_query_text(payload.query_text, payload.question)
    bundle = await runtime.analyze(
        query_text=query_text,
        task_id=(payload.task_id or "").strip() or None,
        video_paths=payload.video_paths,
        top_k=payload.top_k,
    )
    payload = runtime.build_analyze_payload(bundle)
    payload["results"] = [
        {
            "timestamp": item.start,
            "relevance": item.final_score,
            "context": item.text,
            "source": item.source,
            "start": item.start,
            "end": item.end,
        }
        for item in bundle.search.rerank_hits
    ]
    return payload


@router.post("/search")
async def search(
    payload: VQASearchRequest,
    runtime: VQARuntimeService = Depends(get_vqa_runtime),
) -> dict[str, object]:
    query_text = _resolve_query_text(payload.query_text, payload.question)
    bundle = await runtime.search(
        query_text=query_text,
        task_id=(payload.task_id or "").strip() or None,
        video_paths=payload.video_paths,
        top_k=payload.top_k,
    )
    payload = runtime.build_search_payload(bundle)
    payload["results"] = [
        {
            "timestamp": item.start,
            "relevance": item.final_score,
            "context": item.text,
            "source": item.source,
            "start": item.start,
            "end": item.end,
        }
        for item in bundle.result.rerank_hits
    ]
    return payload


@router.post("/chat")
async def chat(
    payload: VQAChatRequest,
    runtime: VQARuntimeService = Depends(get_vqa_runtime),
) -> dict[str, object]:
    query_text = _resolve_query_text(payload.query_text, payload.question)
    bundle = await runtime.analyze(
        query_text=query_text,
        task_id=(payload.task_id or "").strip() or None,
        video_paths=payload.video_paths,
        top_k=payload.top_k,
    )
    response = {
        "trace_id": bundle.trace_id,
        **bundle.chat.to_dict(),
        "hits": [item.to_dict() for item in bundle.search.rerank_hits],
    }
    response["results"] = [
        {
            "timestamp": item.start,
            "relevance": item.final_score,
            "context": item.text,
            "source": item.source,
            "start": item.start,
            "end": item.end,
        }
        for item in bundle.search.rerank_hits
    ]
    return response


@router.post("/chat/stream")
async def chat_stream(
    request: Request,
    payload: VQAChatRequest,
    runtime: VQARuntimeService = Depends(get_vqa_runtime),
) -> StreamingResponse:
    query_text = _resolve_query_text(payload.query_text, payload.question)

    async def event_generator():
        try:
            async for event in runtime.stream_chat(
                query_text=query_text,
                task_id=(payload.task_id or "").strip() or None,
                video_paths=payload.video_paths,
                top_k=payload.top_k,
            ):
                yield f"data: {orjson.dumps(event).decode('utf-8')}\n\n"
        except Exception:  # noqa: BLE001
            developer_log_service = getattr(request.app.state, "developer_log_service", None)
            if developer_log_service is not None:
                try:
                    await developer_log_service.publish(
                        category="error",
                        level="error",
                        source="api.routes_vqa",
                        message="视频问答流式接口发生未处理异常。",
                        task_id=(payload.task_id or "").strip(),
                        event_type="vqa_stream_transport_error",
                        payload={"query_text": query_text},
                    )
                except Exception:  # noqa: BLE001
                    pass
            error_event = {
                "type": "error",
                "error": {
                    "code": "VQA_STREAM_TRANSPORT_ERROR",
                    "message": "流式连接意外中断，请稍后重试。",
                },
            }
            yield f"data: {orjson.dumps(error_event).decode('utf-8')}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/traces/{trace_id}")
async def get_trace(trace_id: str, runtime: VQARuntimeService = Depends(get_vqa_runtime)) -> dict[str, object]:
    return runtime.build_trace_payload(trace_id)


def _resolve_query_text(query_text: str | None, question: str | None) -> str:
    resolved = (query_text or question or "").strip()
    if resolved:
        return resolved
    raise AppError.bad_request(
        "query_text or question is required",
        code="VQA_QUERY_REQUIRED",
        hint="请传入 query_text（兼容字段 question）。",
    )
