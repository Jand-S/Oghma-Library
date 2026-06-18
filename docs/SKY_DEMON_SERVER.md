# Sky Demon Order no servidor — Cloudflare (handoff p/ codex)

## Diagnóstico (definitivo)
- `curl`/`httpx` no container levam **403** em `https://skydemonorder.com/projects?m=all`.
- O Firefox do container (noVNC) **passa**, mas **NÃO há cookie `cf_clearance`** no perfil.
- UA do Firefox do container: `Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0`.
- Logo: o Cloudflare libera pelo **fingerprint do navegador** (TLS/JA3 + ordem de headers + HTTP/2),
  não por cookie. `curl`/`httpx` não reproduzem isso → 403 mesmo com cookies do app
  (XSRF/session/is_mature são só do Laravel, atrás do Cloudflare).
- O "container curl: 200" visto antes foi janela transitória do Cloudflare, não reprodutível.

→ **Cookie não resolve.** Precisa de fingerprint de navegador real.

## Opção A — curl-impersonate (tentar primeiro; leve)
`curl-impersonate` é um build de curl que imita o fingerprint TLS/HTTP do Firefox/Chrome.
Como o Firefox passa **sem** cf_clearance, isso provavelmente passa também.

Passos:
1. **Imagem (Dockerfile do crawler):** instalar o `curl-impersonate` (Firefox).
   Ex.: baixar o release de `lwthiker/curl-impersonate` (binário `curl_ff` / `curl-impersonate-ff`)
   ou usar a imagem base `lwthiker/curl-impersonate`. Garantir que o wrapper `curl_ff` fica no PATH.
2. **Fetcher:** hoje `_curl_get` usa `shutil.which("curl")`. Adicionar um ajuste pro sky-demon-order
   usar o binário de impersonate (ex.: setting `curl_bin` / `curl_impersonate=True` no connector, e o
   fetcher usa `curl_ff` em vez de `curl`). Deixar o `curl_ff` aplicar os headers/UA dele
   (não sobrescrever User-Agent/Accept — senão quebra o fingerprint).
3. **Cookie:** manter só `is_mature` (pra conteúdo adulto); XSRF/session do app provavelmente não são
   necessários só pra listar. Se a listagem exigir sessão, aí precisa renovar (ver Opção B).
4. **Teste:** `docker compose run --rm crawler oghma crawl --source sky-demon-order --limit 2`.
   Diagnóstico do corpo: se vier "Just a moment"/"Attention Required" = challenge JS (ir pra Opção B);
   se vier HTML de projetos = passou.

Vantagem: roda headless, sem clicar, bom pra cron. Sem juggling de cookie curto.

## Opção B — BrowserFetcher (à prova de bala; pesado)
Se o Cloudflare exigir **execução de JS** (challenge), só navegador real resolve.
- Adicionar um fetcher browser-backed (`fetcher_kind="browser"`) só pro sky-demon-order, usando
  Playwright/Selenium contra o **perfil persistente** que já existe: `/home/codex/skydemon-browser`.
- O crawler navega e extrai o HTML renderizado; cf_clearance/sessão **renovam sozinhos** a cada visita.
- Para cron: o perfil persistente mantém a sessão; roda sem intervenção.
- Custo: imagem maior (browser + driver), mais lento.

## Recomendação
1. Tentar **A (curl-impersonate)** — mudança pequena, alta chance de passar (é gate de fingerprint).
2. Se aparecer challenge JS, ir pra **B (BrowserFetcher)** com o perfil persistente.

## Cron / expiração
- Cookies do app (XSRF/session) expiram ~2h → **não** servem pra cron.
- `cf_clearance` não existe aqui (gate é fingerprint).
- Portanto, pro cron semanal/mensal: **A** (sem cookie de sessão) ou **B** (perfil persistente) —
  ambos sem depender de cookie curto.

## Status atual
- `sky_demon_order.py` já tem `use_curl = True` e lê `OGHMA_SKY_DEMON_ORDER_COOKIE`.
- `fetcher.py` já tem o transporte via `curl` (`_curl_get`) — falta só apontar pro `curl-impersonate`.
- Run preso em `crawl_run` (processo local morto): marcar `status='failed'` pelo `id` (ver monitor).

---

## Solução implementada — Opção A (curl-impersonate) ✓ 2026-06-18

**Resultado:** `crawl --source sky-demon-order --limit 2` retornou `status=done`, `errors=0`,
2 novels processadas, 56 capítulos vistos sem nenhum 403. Opção B (BrowserFetcher) não foi necessária.

### 1. Dockerfile (`~/oghma/Dockerfile`)

Bloco novo adicionado após o `apt-get`:

```dockerfile
RUN set -eux \
    && mkdir -p /opt/curl-impersonate \
    && curl -fsSL \
       "https://github.com/lwthiker/curl-impersonate/releases/download/v0.6.1/curl-impersonate-v0.6.1.x86_64-linux-gnu.tar.gz" \
       | tar -xz -C /opt/curl-impersonate \
    && chmod +x /opt/curl-impersonate/curl-impersonate-ff /opt/curl-impersonate/curl_ff* \
    && cp /opt/curl-impersonate/curl_ff117 /opt/curl-impersonate/curl_ff
ENV PATH="/opt/curl-impersonate:${PATH}"
```

Detalhes:
- Release v0.6.1 (lwthiker/curl-impersonate), variante Firefox, x86_64-linux-gnu.
- `curl-impersonate-ff` é o binário compilado com **NSS/3.92** (libssl do Firefox) — glibc/zlib são as
  únicas dependências dinâmicas; nada extra precisa ser instalado no container slim.
- O wrapper `curl_ff117` configura os cipher suites, curvas e headers exatos do Firefox 117.
- `cp` em vez de `ln -s` porque o wrapper usa `dir=${0%/*}` para achar `curl-impersonate-ff`;
  um symlink para outro diretório quebraria esse `dir`.
- `curl_ff` é o nome usado pelo fetcher; aponta para `curl_ff117` (Firefox 117, o mais recente no v0.6.1).

### 2. `src/oghma/scraper/fetcher.py`

- `HttpFetcher.__init__` ganhou dois parâmetros: `curl_bin: str = "curl"` e derivado
  `self._curl_impersonate = curl_bin != "curl"`.
- `_curl_get` usa `shutil.which(self.curl_bin)` em vez de `shutil.which("curl")`.
- Quando `_curl_impersonate=True`:
  - Não injeta nenhum `-H` (User-Agent, Accept, etc.) — esses headers são adicionados
    automaticamente pelo wrapper `curl_ff` e fazem parte do fingerprint.
  - Injeta só o `Cookie` se presente em `self.headers`.
  - Adiciona `-k` (skip SSL verification) porque o NSS compilado estaticamente no binário
    não encontra o CA bundle PEM do container (`--cacert` retorna erro 77 com NSS estático).

### 3. `src/oghma/scraper/connectors/sky_demon_order.py`

Atributo novo na classe `SkyDemonOrderConnector`:

```python
curl_bin = "curl_ff"   # impersonation binary; o orchestrator lê e repassa ao fetcher
```

O `use_curl = True` e `http2 = False` já existiam mas nunca eram lidos pelo orchestrator.

### 4. `src/oghma/scraper/orchestrator.py`

A linha que instanciava o fetcher foi expandida para ler `use_curl`, `curl_bin` e `http2` do connector:

```python
use_curl = getattr(connector, "use_curl", False)
curl_bin  = getattr(connector, "curl_bin", "curl")
http2     = getattr(connector, "http2", True)
fetcher   = HttpFetcher(
    connector.rate_limit_seconds,
    headers=headers,
    use_curl=use_curl,
    curl_bin=curl_bin,
    http2=http2,
)
```

Sem essa mudança, `use_curl=True` no connector era ignorado e o crawl usava httpx (→ 403).

### Por que `-k` é aceitável aqui

O `-k` desliga a verificação do certificado TLS do servidor. Para um scraper pessoal de sites
públicos já acessados pelo browser, o risco é baixo: o Cloudflare em si assina o certificado
do edge, e a conexão ainda é cifrada. A alternativa seria criar um banco de dados NSS no
container e importar os CAs do Debian — complexidade desnecessária para este caso de uso.
