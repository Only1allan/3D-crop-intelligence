from __future__ import annotations

from .fixture import FixtureAdapter
from .openmeteo import OpenMeteoAdapter

ADAPTERS = {a.name: a for a in (FixtureAdapter(), OpenMeteoAdapter())}


def get_adapter(name: str):
    try:
        return ADAPTERS[name]
    except KeyError:
        raise KeyError(f"unknown adapter '{name}'; known: {sorted(ADAPTERS)}") from None
