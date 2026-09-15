"""Background poller: fetch readsb -> cache -> publish over SSE.

A single upstream (one readsb host), so this is a straightforward loop rather
than a multi-service fan-out. Publishes two event types:

  - "radar": the full normalized snapshot (aircraft + receiver + aggregates)
  - "stats": readsb statistics periods

The instantaneous message rate is derived here from the inter-poll delta of the
cumulative message counter, since readsb's own period stats span days.
"""

import asyncio
import logging
import time

logger = logging.getLogger(__name__)


async def run_collector(service, cache, sse_manager, interval: float, history=None) -> None:
    prev_messages: int | None = None
    prev_ts: float | None = None
    loop = asyncio.get_running_loop()

    while True:
        loop_start = time.monotonic()
        try:
            data = await service.fetch_status()
            snapshot = data["snapshot"]
            stats = data["stats"]

            # Derive instantaneous Mode S message rate from the cumulative counter.
            now_ts = time.monotonic()
            msgs = snapshot.get("messages_total", 0)
            if prev_messages is not None and prev_ts is not None:
                dt = now_ts - prev_ts
                if dt > 0 and msgs >= prev_messages:
                    snapshot["messages_per_sec"] = round((msgs - prev_messages) / dt, 1)
            prev_messages, prev_ts = msgs, now_ts

            cache.set("radar", snapshot)
            cache.set("stats", stats)
            await sse_manager.publish("radar", snapshot)
            await sse_manager.publish("stats", stats)

            # Fold into the durable history off the event loop (SQLite writes).
            if history is not None:
                await loop.run_in_executor(None, history.record, snapshot)
        except Exception as exc:  # noqa: BLE001
            logger.warning("readsb poll failed: %s", exc)
            if history is not None:
                await loop.run_in_executor(None, history.record_gap)

        elapsed = time.monotonic() - loop_start
        await asyncio.sleep(max(0.0, interval - elapsed))
