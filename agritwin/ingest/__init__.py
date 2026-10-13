"""Ingestion adapters. Each adapter turns an external source into rows in the twin store.

To add a source (a CSV from a cooperative, a soil-lab API, an IoT broker), implement
`base.Adapter` and register it in `registry.ADAPTERS`; the MCP server exposes registered
adapters through `list_adapters` and the `ingest_*` tools."""
from .registry import ADAPTERS, get_adapter  # noqa: F401
