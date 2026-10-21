"""Erro da conta com código estável, usado por todos os módulos do serviço."""
from __future__ import annotations

from typing import Any


class AccountError(Exception):
    """Erro com código estável (o app traduz) e status HTTP."""

    def __init__(self, code: str, status: int = 400, **extra: Any) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.extra = extra
