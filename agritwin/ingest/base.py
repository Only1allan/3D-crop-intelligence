from __future__ import annotations

from typing import Any, Protocol


class Adapter(Protocol):
    """An ingestion adapter: pulls from a source and writes to the twin store, returning a summary."""

    name: str
    description: str

    def run(self, **kwargs: Any) -> dict: ...
