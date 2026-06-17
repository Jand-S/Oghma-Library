from __future__ import annotations

from .base import SiteConnector

_REGISTRY: dict[str, SiteConnector] = {}


def register(connector: SiteConnector) -> SiteConnector:
    _REGISTRY[connector.id] = connector
    return connector


def get(source_id: str) -> SiteConnector:
    if source_id not in _REGISTRY:
        raise KeyError(f"conector nao registrado: {source_id}")
    return _REGISTRY[source_id]


def all_connectors() -> list[SiteConnector]:
    return list(_REGISTRY.values())
