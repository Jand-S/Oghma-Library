"""Envio do código de login. "resend" em produção; "log" escreve o código no log (desenvolvimento)."""
from __future__ import annotations

import html
import logging
from typing import Protocol

import httpx

log = logging.getLogger("oghma.accounts.mail")


class Mailer(Protocol):
    async def send_code(self, email: str, code: str) -> None: ...


def code_email(code: str) -> tuple[str, str, str]:
    """Assunto, texto e HTML do e-mail com o código (visual do app: escuro, código grande)."""
    subject = f"{code} é o seu código do Oghma"
    text = (
        f"Seu código para entrar no Oghma é {code}.\n\n"
        "Ele vale por 10 minutos. Se não foi você que pediu, ignore este e-mail."
    )
    spaced = html.escape(" ".join(code))
    body = f"""<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#19191b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#f5f5f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#222224;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:40px 32px">
<tr><td style="font-size:15px;font-weight:600;letter-spacing:.02em;color:#4db6ac">Oghma</td></tr>
<tr><td style="padding-top:24px;font-size:22px;font-weight:600;line-height:1.3">Seu código para entrar</td></tr>
<tr><td style="padding-top:24px"><div style="font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;font-size:34px;font-weight:600;letter-spacing:.18em;color:#f5f5f7">{spaced}</div></td></tr>
<tr><td style="padding-top:24px;font-size:14px;line-height:1.5;color:#a8a8ae">Digite este código no app. Ele vale por 10 minutos.<br>Se não foi você que pediu, ignore este e-mail.</td></tr>
</table>
</td></tr></table></body></html>"""
    return subject, text, body


class LogMailer:
    """Desenvolvimento: o código aparece no log do servidor."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def send_code(self, email: str, code: str) -> None:
        self.sent.append((email, code))
        log.warning("Código de login para %s: %s", email, code)


class ResendMailer:
    def __init__(self, api_key: str, sender: str) -> None:
        if not api_key:
            raise RuntimeError("OGHMA_ACCOUNTS_RESEND_API_KEY não configurada")
        self.api_key = api_key
        self.sender = sender

    async def send_code(self, email: str, code: str) -> None:
        subject, text, body = code_email(code)
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"from": self.sender, "to": [email], "subject": subject, "text": text, "html": body},
            )
        if response.status_code >= 300:
            log.error("Resend recusou o envio (%s): %s", response.status_code, response.text[:300])
            raise RuntimeError("Não foi possível enviar o e-mail")
