from __future__ import annotations

import orjson
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

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
    bundle = await runtime.analyze(
        query_text=payload.query_text.strip(),
        task_id=(payload.task_id or "").strip() or None,
        video_paths=payload.video_paths,
        top_k=payload.top_k,
    )
    return runtime.build_analyze_payload(bundle)


@router.post("/search")
async def search(
    payload: VQASearchRequest,
    runtime: VQARuntimeService = Depends(get_vqa_runtime),
) -> dict[str, object]:
    bundle = runtime.search(
        query_text=payload.query_text.strip(),
        task_id=(payload.task_id or "").strip() or None,
        video_paths=payload.video_paths,
        top_k=payload.top_k,
    )
    return runtime.build_search_payload(bundle)


@router.post("/chat")
async def chat(
    payload: VQAChatRequest,
    runtime: VQARuntimeService = Depends(get_vqa_runtime),
) -> dict[str, object]:
    bundle = await runtime.analyze(
        query_text=payload.query_text.strip(),
        task_id=(payload.task_id or "").strip() or None,
        video_paths=payload.video_paths,
        top_k=payload.top_k,
    )
    return {
        "trace_id": bundle.trace_id,
        **bundle.chat.to_dict(),
        "hits": [item.to_dict() for item in bundle.search.rerank_hits],
    }


@router.post("/chat/stream")
async def chat_stream(
    payload: VQAChatRequest,
    runtime: VQARuntimeService = Depends(get_vqa_runtime),
) -> StreamingResponse:
    async def event_generator():
        async for event in runtime.stream_chat(
            query_text=payload.query_text.strip(),
            task_id=(payload.task_id or "").strip() or None,
            video_paths=payload.video_paths,
            top_k=payload.top_k,
        ):
            yield f"data: {orjson.dumps(event).decode('utf-8')}\n\n"
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
