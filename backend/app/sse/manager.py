import asyncio
import json
import logging
from datetime import UTC, datetime

logger = logging.getLogger(__name__)


class SSEManager:
    def __init__(self) -> None:
        self._clients: set[asyncio.Queue[dict]] = set()
        # Latest event per event_type, replayed to new subscribers so a
        # client that connects between polls (e.g. the kiosk) sees the
        # current state immediately instead of waiting up to 30 minutes
        # for the next backups poll.
        self._last_events: dict[str, dict] = {}

    @property
    def client_count(self) -> int:
        return len(self._clients)

    def subscribe(self) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=50)
        # Replay the aggregate 'dashboard' event first. The client uses it to
        # discover service event names (e.g. 'kubernetes:talos') and register
        # listeners for them. EventSource silently drops events with no
        # registered listener, so any per-service event replayed before
        # 'dashboard' would be lost — leaving the kiosk stuck on stale data
        # until the next poll cycle.
        dashboard_event = self._last_events.get("dashboard")
        if dashboard_event is not None:
            try:
                queue.put_nowait(dashboard_event)
            except asyncio.QueueFull:
                pass
        for event_type, event in self._last_events.items():
            if event_type == "dashboard":
                continue
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                break
        self._clients.add(queue)
        logger.info(
            "SSE client connected (total: %d, replayed: %d)",
            len(self._clients),
            len(self._last_events),
        )
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        self._clients.discard(queue)
        logger.info("SSE client disconnected (total: %d)", len(self._clients))

    async def publish(self, event_type: str, data: dict) -> None:
        event = {
            "type": event_type,
            "data": data,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        self._last_events[event_type] = event

        if not self._clients:
            return

        dead_clients: list[asyncio.Queue[dict]] = []
        for queue in self._clients:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Drop event for slow consumers
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    dead_clients.append(queue)

        for client in dead_clients:
            self._clients.discard(client)

    def publish_json(self, event_type: str, data: dict) -> str:
        """Serialize an event to SSE format string."""
        return json.dumps({"type": event_type, "data": data})
