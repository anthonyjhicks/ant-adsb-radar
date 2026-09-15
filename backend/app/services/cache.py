import time
from typing import Any


class TTLCache:
    """Simple in-memory TTL cache."""

    def __init__(self, default_ttl: int = 15) -> None:
        self._store: dict[str, tuple[float, Any]] = {}
        self._default_ttl = default_ttl

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        expires_at = time.monotonic() + (ttl or self._default_ttl)
        self._store[key] = (expires_at, value)

    def invalidate(self, key: str) -> None:
        self._store.pop(key, None)

    def invalidate_all(self) -> None:
        self._store.clear()
