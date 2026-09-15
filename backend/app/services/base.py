import logging
from abc import ABC, abstractmethod

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


class BaseService(ABC):
    """Abstract base for all service integrations."""

    @abstractmethod
    async def fetch_status(self) -> dict:
        """Fetch current status data from the service. Returns serializable dict."""
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """Quick connectivity check. Returns True if reachable."""
        ...

    @abstractmethod
    async def close(self) -> None:
        """Clean up connections."""
        ...


class HTTPService(BaseService):
    """Base class for services using HTTP APIs."""

    def __init__(
        self,
        base_url: str,
        headers: dict[str, str] | None = None,
        verify_ssl: bool = False,
        timeout: float = 10.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers or {},
            verify=verify_ssl,
            timeout=timeout,
        )

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=10))
    async def _get(self, path: str, **kwargs) -> dict:
        resp = await self.client.get(path, **kwargs)
        resp.raise_for_status()
        return resp.json()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=10))
    async def _get_bytes(self, path: str, **kwargs) -> bytes:
        """Fetch a raw binary body (e.g. protobuf payloads)."""
        resp = await self.client.get(path, **kwargs)
        resp.raise_for_status()
        return resp.content

    async def health_check(self) -> bool:
        try:
            await self.client.get("/", timeout=5.0)
            return True
        except Exception:
            return False

    async def close(self) -> None:
        await self.client.aclose()
