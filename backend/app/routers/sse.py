import asyncio
import json

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse, ServerSentEvent

router = APIRouter(tags=["sse"])


@router.get("/api/events")
async def event_stream(request: Request):
    sse_manager = request.app.state.sse_manager

    queue = sse_manager.subscribe()

    async def generate():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield ServerSentEvent(
                        data=json.dumps(event["data"]),
                        event=event["type"],
                        id=event["timestamp"],
                    )
                except asyncio.TimeoutError:
                    # Send keepalive comment
                    yield ServerSentEvent(comment="keepalive")
        finally:
            sse_manager.unsubscribe(queue)

    return EventSourceResponse(generate())
