# Contexto comum dos subagentes do autoconnector

Você faz parte de uma cadeia que cria um **conector de site de novels** para o Oghma Library. Cada papel tem uma tarefa só; leia os arquivos que o papel anterior deixou e entregue os seus. Escreva relatórios em português; código e testes seguem o estilo do repositório.

## O projeto
- Backend Python 3.11 em `backend/src/oghma/`. Conectores em `backend/src/oghma/scraper/connectors/<modulo>.py`, um por site.
- Contrato em `backend/src/oghma/scraper/base.py` (`SiteConnector`): atributos `id`, `display_name`, `base_url`, `capabilities`, `rate_limit_seconds` e os métodos `discover_novels(fetcher, limit)`, `fetch_novel(fetcher, ref)`, `list_chapters(fetcher, novel)`, `fetch_chapter(fetcher, url)`, `normalize_chapter(raw)`.
- **Obrigatório também:** `ref_from_url(url) -> NovelRef | None`, que transforma a URL da página de uma novel no `NovelRef` dela (é como a novel pedida pelo usuário é baixada primeiro).
- Registro: importar o módulo em `backend/src/oghma/scraper/connectors/__init__.py` e chamar `register(<Classe>())` no fim do módulo, como os outros.
- Seed: acrescentar a fonte na lista `seeds` de `seed_sources()` em `backend/src/oghma/cli.py` (`id`, `name`, `base_url`, `mode`, `rate_limit_seconds`).
- O `fetcher` já faz limite por domínio e novas tentativas em erro passageiro. Use `fetcher.get(url)` (HTML/bytes) e `fetcher.get_json(url, params=...)`. Não use `requests`/`httpx` direto.
- Normalização: use `normalize(raw, "<seletor do conteúdo>")` de `scraper/normalize.py`. Ela devolve HTML limpo (só `p`, `em`, `strong`, `img`, `blockquote`, `hr`), o hash e a contagem de palavras.
- A sinopse pode sair em HTML: o orquestrador limpa com `clean_description`. Mas pegue **só o bloco da sinopse**, sem avisos do site, créditos, botões ou links de doação.

## Regras do domínio (vêm de problemas reais)
- Capítulo vazio, "Loading...", página de "rate limit" ou de desafio anti-bot **não é capítulo**. Se o site entrega o texto por API/JSON depois de carregar, use essa API.
- Número do capítulo: o número real, crescente. Se o site lista o mesmo número duas vezes, mantenha um só (não invente `4.01`). Volumes: se o site numera por volume, gere um número crescente estável e guarde o rótulo no título.
- URLs absolutas. Se o site reorganiza URLs, prefira ids estáveis do site.
- `rate_limit_seconds` no mínimo 1.0; use mais se o site for sensível.
- `language`: o idioma do conteúdo (`pt-BR`, `en`, ...).
- Nada de segredos, cookies pessoais ou tokens no código.

## Arquivos de trabalho (pasta `backend/autoconnector/work/`)
- `REQUEST.json`: o pedido (URL do site e da novel, id sugerido para a fonte).
- `SITE_REPORT.md`: análise do site (site-analyst).
- `REVIEW.md`: revisão (qa-reviewer), com `veredito: approve` ou `veredito: changes`.
- `GATE.json`: resultado do portão automático (pytest + probe ao vivo), escrito pelo worker.
- `AGENT_NOTES.md`: anotações curtas para quem vier depois (cada papel acrescenta uma seção).
- Fixtures reais do site: `backend/tests/fixtures/<source_id>/`.

## Helpers comuns

Importe de `oghma.scraper.connectors._common` (`attr`, `meta_content`) em vez de copiar
helpers de outro conector. Preencha também `source_chapter_count` quando o site mostra o
total de capítulos: o portão confere se a listagem chega nele.

## O que o portão exige da novel de teste

Título, sinopse (em pelo menos uma das novels amostradas), capa, **tags/gêneros**, capítulos
listados com números únicos e, se o site anuncia o total, a listagem chegando a ele (até 2% de
diferença). Autor e nota entram quando o site tem.

## Exemplos para copiar o estilo
- WordPress / API REST: `connectors/golden_novel.py`, `connectors/rolia_scan.py`
- API JSON própria: `connectors/house_saikai.py`, `connectors/novel_mania.py`
- HTML puro: `connectors/central_novel.py`
- Testes: `backend/tests/test_rolia_scan.py` (fixtures embutidas e um `FakeFetcher`)
