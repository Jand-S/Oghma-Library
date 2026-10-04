"""Envio do código de login. "resend" em produção; "log" escreve o código no log (desenvolvimento)."""
from __future__ import annotations

import html
import logging
from typing import Protocol

import httpx

log = logging.getLogger("oghma.accounts.mail")


class Mailer(Protocol):
    async def send_code(self, email: str, code: str, link: str) -> None: ...


def code_email(code: str, link: str, logo_url: str = "https://conta.oghma.dev/marca/oghma.png") -> tuple[str, str, str]:
    """Assunto, texto e HTML do e-mail: o botão "Entrar no Oghma" e o código, no visual do app.

    O código fica numa linha só (sem espaços que o celular quebre) e fora do alcance dos detectores
    de número de telefone do iOS/Gmail.
    """
    subject = f"{code} é o seu código do Oghma"
    text = (
        f"Para entrar no Oghma, abra este link e confirme:\n{link}\n\n"
        f"Ou digite o código {code} no app.\n\n"
        "O link e o código valem por 10 minutos. Se não foi você que pediu, ignore este e-mail."
    )
    safe_link = html.escape(link, quote=True)
    safe_logo = html.escape(logo_url, quote=True)
    # Dois grupos de três dígitos, cada dígito separado por um zero-width joiner: não vira link de
    # telefone nem quebra de linha.
    half = len(code) // 2
    first, second = ("&#8288;".join(html.escape(d) for d in part) for part in (code[:half], code[half:]))
    body = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">
<style>a[x-apple-data-detectors]{{color:inherit!important;text-decoration:none!important}}
@media (max-width:480px){{.code{{font-size:30px!important;letter-spacing:4px!important}}.card{{padding:32px 20px!important}}}}</style></head>
<body style="margin:0;background:#19191b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#f5f5f7">
<div style="display:none;max-height:0;overflow:hidden">Toque em Entrar no Oghma ou use o código {html.escape(code)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px">
<tr><td align="center">
<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#222224;border:1px solid #333336;border-radius:18px;padding:36px 32px">
<tr><td align="center"><img src="{safe_logo}" width="56" height="56" alt="Oghma" style="display:block;width:56px;height:56px;border-radius:14px;border:0"></td></tr>
<tr><td align="center" style="padding-top:20px;font-size:22px;font-weight:600;line-height:1.3;color:#f5f5f7">Entrar no Oghma</td></tr>
<tr><td align="center" style="padding-top:8px;font-size:15px;line-height:1.5;color:#a8a8ae">Toque no botão e confirme. O app no seu computador continua sozinho.</td></tr>
<tr><td align="center" style="padding-top:24px">
<a href="{safe_link}" style="display:inline-block;padding:14px 32px;border-radius:12px;background:#00796b;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none">Entrar no Oghma</a>
</td></tr>
<tr><td align="center" style="padding-top:28px;font-size:13px;color:#a8a8ae">ou digite este código no app</td></tr>
<tr><td align="center" style="padding-top:8px">
<span class="code" style="display:inline-block;white-space:nowrap;font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;font-size:34px;font-weight:600;letter-spacing:6px;color:#f5f5f7">{first}<span style="display:inline-block;width:14px"></span>{second}</span>
</td></tr>
<tr><td align="center" style="padding-top:28px;font-size:13px;line-height:1.5;color:#7c7c82">O link e o código valem por 10 minutos.<br>Se não foi você que pediu, ignore este e-mail.</td></tr>
</table>
</td></tr></table></body></html>"""
    return subject, text, body


class LogMailer:
    """Desenvolvimento: o código e o link aparecem no log do servidor."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str]] = []

    async def send_code(self, email: str, code: str, link: str) -> None:
        self.sent.append((email, code, link))
        log.warning("Código de login para %s: %s (%s)", email, code, link)


class ResendMailer:
    def __init__(self, api_key: str, sender: str, logo_url: str) -> None:
        if not api_key:
            raise RuntimeError("OGHMA_ACCOUNTS_RESEND_API_KEY não configurada")
        self.api_key = api_key
        self.sender = sender
        self.logo_url = logo_url

    async def send_code(self, email: str, code: str, link: str) -> None:
        subject, text, body = code_email(code, link, self.logo_url)
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"from": self.sender, "to": [email], "subject": subject, "text": text, "html": body},
            )
        if response.status_code >= 300:
            log.error("Resend recusou o envio (%s): %s", response.status_code, response.text[:300])
            raise RuntimeError("Não foi possível enviar o e-mail")
