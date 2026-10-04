"""Página do botão do e-mail ("Entrar no Oghma"): confirma o login do computador que está esperando.

Abrir o link não aprova nada (leitores de e-mail e antivírus abrem links sozinhos): a página pede um
toque em "Confirmar" (POST). Visual do app: escuro, cartão central, sem JavaScript.
"""
from __future__ import annotations

import html
from pathlib import Path

from fastapi.responses import HTMLResponse

from .models import AccountLoginCode

BRAND_DIR = Path(__file__).parent / "brand"

PLATFORM_NAMES = {"macos": "Mac", "windows": "Windows", "linux": "Linux"}

_STYLE = """
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{display:grid;place-items:center;padding:24px;background:#19191b;color:#f5f5f7;
  font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Helvetica,Arial,sans-serif}
.card{width:100%;max-width:420px;padding:40px 32px 32px;border:1px solid rgba(255,255,255,.08);
  border-radius:18px;background:#222224;text-align:center;box-shadow:0 16px 40px rgba(0,0,0,.42)}
.logo{width:56px;height:56px;border-radius:14px}
h1{margin:20px 0 8px;font-size:22px;font-weight:600;letter-spacing:-.01em}
p{margin:0;color:#a8a8ae}
.device{display:flex;align-items:center;gap:12px;margin:24px 0;padding:14px 16px;border-radius:12px;
  background:#2a2a2d;text-align:left}
.device b{display:block;color:#f5f5f7;font-weight:600}
.device span{color:#a8a8ae;font-size:13px}
.glyph{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:10px;background:#3a3a3c;font-size:18px}
button{width:100%;min-height:48px;border:0;border-radius:12px;background:#00796b;color:#fff;
  font:inherit;font-size:16px;font-weight:600;cursor:pointer}
button:hover{background:#00897b}
.fine{margin-top:16px;font-size:13px}
.ok{display:grid;place-items:center;width:56px;height:56px;margin:0 auto;border-radius:50%;background:rgba(118,184,120,.16);color:#76b878;font-size:28px}
.warn{display:grid;place-items:center;width:56px;height:56px;margin:0 auto;border-radius:50%;background:rgba(217,164,65,.14);color:#d9a441;font-size:28px}
"""


def _page(title: str, body: str, status: int = 200) -> HTMLResponse:
    document = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{html.escape(title)} · Oghma</title><style>{_STYLE}</style></head>
<body><main class="card">{body}</main></body></html>"""
    return HTMLResponse(
        document,
        status_code=status,
        headers={
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _device(row: AccountLoginCode | None) -> str:
    name = html.escape((row.device_name if row else "") or "Computador")
    platform = PLATFORM_NAMES.get((row.platform if row else "") or "", "")
    email = html.escape(row.email if row else "")
    detail = " · ".join(part for part in (platform, email) if part)
    return f'<div class="device"><div class="glyph">💻</div><div><b>{name}</b><span>{detail}</span></div></div>'


def approval_page(state: str, row: AccountLoginCode | None, link_token: str) -> HTMLResponse:
    logo = '<img class="logo" src="/marca/oghma.png" alt="Oghma">'
    if state == "pending":
        token = html.escape(link_token, quote=True)
        return _page(
            "Entrar no Oghma",
            f"""{logo}<h1>Entrar no Oghma?</h1>
<p>Confirme para entrar neste computador. Ele está esperando e continua sozinho.</p>
{_device(row)}
<form method="post" action="/entrar/{token}"><button type="submit">Confirmar e entrar</button></form>
<p class="fine">Não foi você? Feche esta página. Ninguém entra sem esta confirmação ou o código.</p>""",
        )
    if state in ("done", "approved"):
        return _page(
            "Pronto",
            f"""<div class="ok">✓</div><h1>Pronto!</h1>
<p>Volte ao Oghma{(" no " + html.escape(row.device_name)) if row and row.device_name else ""}: a entrada termina sozinha em instantes.</p>
<p class="fine">Pode fechar esta página.</p>""",
        )
    if state == "used":
        return _page(
            "Link já usado",
            """<div class="ok">✓</div><h1>Este link já foi usado</h1>
<p>A entrada já aconteceu (ou um código mais novo foi pedido). Se precisar, peça outro código no app.</p>""",
        )
    return _page(
        "Link expirado",
        """<div class="warn">!</div><h1>Este link expirou</h1>
<p>Os links valem por 10 minutos. Peça um novo código no app do Oghma.</p>""",
        status=410,
    )
