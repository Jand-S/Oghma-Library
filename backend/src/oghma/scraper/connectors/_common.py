"""Helpers shared by the connectors.

New connectors (including the ones the autoconnector writes) import from here instead of
copying helpers from an existing connector. Only helpers that were byte-for-byte identical
across connectors live here; connector-specific variants (status words, chapter numbers)
stay in their modules on purpose.
"""
from __future__ import annotations

from selectolax.parser import HTMLParser, Node


def attr(node: Node | None, name: str) -> str | None:
    """Attribute value, stripped; None when the node or the attribute is missing or blank."""
    if node is None:
        return None
    value = node.attributes.get(name)
    return value.strip() if value else None


def meta_content(tree: HTMLParser, *names: str) -> str | None:
    """First non-empty `<meta property|name=...>` content among `names`."""
    for name in names:
        value = attr(tree.css_first(f"meta[property='{name}'], meta[name='{name}']"), "content")
        if value:
            return value
    return None
