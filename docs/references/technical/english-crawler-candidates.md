# English crawler candidates from NovelUpdates

Primeira triagem em 17/06/2026 para decidir quais fontes em ingles valem virar conectores proprios no Oghma.

## Contexto

- Fonte de descoberta: <https://www.novelupdates.com/groupslist/>
- O `groupslist` do NovelUpdates mostra 81 paginas de grupos.
- `curl`/HTTP direto recebeu Cloudflare managed challenge (`403`). A leitura funcionou via pagina renderizada/cache web.
- As paginas de grupo exibem `Series (N)`, `Releases N` e a paginacao de releases. A paginacao bate com cerca de 25 releases por pagina.
- Esta doc e uma primeira triagem de grupos grandes/ativos. Ainda nao e uma varredura completa dos ~8k grupos.

## Medidas coletadas

| Grupo NU | Slug NU | Series | Releases | Paginas de releases | Sinal de atividade | Observacao |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Foxaholic | `foxaholic` | 1497 | 76084 | 3044 | releases em 17/06/2026 | Volume enorme, muitos generos, forte candidato se o site direto for acessivel. |
| Chrysanthemum Garden | `chrysanthemum-garden` | 757 | 58827 | 2354 | releases em 17/06/2026 | Muito volume e muito ativo; forte em BL/danmei. Bom se aceitarmos esse recorte. |
| Webnovel | `webnovel` | 910 | 47786 | 1912 | releases em 2026 | Oficial/possivel paywall/anti-bot. Alto volume, mas nao parece bom primeiro alvo. |
| Gravity Tales | `gravity-tales` | 204 | 43527 | 1742 | releases em 17/06/2026 | Volume enorme, mas o grupo parece agregado/ambiguidade de origem; precisa verificar dominio real. |
| Hosted Novel | `hosted-novel` | 51 | 33323 | 1333 | releases em 17/06/2026 | Poucas series, muitos capitulos. Otimo candidato se o site tiver HTML estavel. |
| Sky Demon Order | `sky-demon-order` | nao capturado nesta passada | 27376 | 1096 | releases em 16/06/2026 | Muito ativo. Bom candidato para teste tecnico inicial. |
| Readhive | `readhive` | 358 | 23135 | 926 | releases em 08/06/2026 | Muito volume, perfil KR/romance/fantasy. Bom candidato. |
| Golden Novel | `golden-novel` | 159 | 21120 | 845 | releases em 10/05/2026 | Volume alto e catalogo concentrado. Bom candidato para probe tecnico junto com Readhive/Sky Demon Order. |
| Fans Translations | `fans-translations` | 185 | 19233 | 770 | releases vistas em 2025 | Volume alto, mas atividade recente menos clara nesta passada. Candidato secundario. |
| volarenovels | `volare-novels` | 60 | 18316 | 733 | ultimo release visto em 2022 | Acervo grande, mas legado/baixa atividade. Bom para preservacao, nao para incremental vivo. |
| Creative Novels | `creative-novels` | 90 | 14997 | 600 | ultimo release visto em 2025 | Acervo medio-grande; candidato secundario. |
| Second Life Translations | `second-life-translations` | nao capturado nesta passada | 12589 | 504 | releases em 12/06/2026 | Ativo e com bom volume. Vale entrar no probe tecnico. |
| Flying Lines | `flying-lines` | 284 | 10677 | 428 | releases antigas vistas no topo | Acervo grande, mas parece legado/desordenado; baixa prioridade incremental. |
| Wuxiaworld | `wuxiaworld` | 253 | 9634 | 386 | releases em 2026 | Oficial/comercial. Pode ter paywall e anti-bot; nao recomendo como primeiro crawler. |
| Reaper Scans | `reaper-scans` | 59 | 7411 | 297 | ultimo release visto em 2025 | Popular, mas pode misturar novel/manhwa e ter Cloudflare forte. Candidato tecnico dificil. |
| Asian Hobbyist | `asian-hobbyist` | 207 | 7114 | 285 | releases em 21/05/2026 | Ativo e catalogo amplo; candidato secundario bom. |
| wordexcerpt | `wordexcerpt` | 103 | 2349 | 94 | releases em 2026 | Volume menor; candidato baixo/medio. |
| Ainushi Translations | `ainushi-translations` | 36 | 737 | 30 | ultimo release visto em 2023 | Pequeno para nosso objetivo atual. |
| Travis Translations | `travis-translations` | 7 | 126 | 6 | releases em 2026 | Muito pequeno para justificar crawler proprio agora. |

## Recomendacao inicial

Priorizar conectores por combinacao de volume, atividade recente e chance de site simples:

1. **Hosted Novel**: bom equilibrio para primeiro alvo. Tem 33k releases em apenas 51 series, entao um conector rende bastante sem catalogo muito amplo.
2. **Sky Demon Order**: 27k releases e atividade muito recente. Vale probe tecnico logo depois.
3. **Readhive**: 23k releases, 358 series, ativo e provavelmente vale crawler proprio.
4. **Golden Novel**: 21k releases em 159 series, ainda com releases em 2026. Boa opcao por ter volume alto sem ser gigantesco.
5. **Second Life Translations**: 12k releases e atividade em junho/2026. Bom candidato extra para probe.
6. **Chrysanthemum Garden**: enorme e muito ativo, mas tem recorte forte de BL/danmei. Vale se esse conteudo for desejado no acervo.
7. **Foxaholic**: maior volume da primeira triagem. Candidato forte, mas por ser muito grande, eu colocaria depois de validarmos o padrao tecnico em 1-2 sites menores.

## Deixar para depois

- **Webnovel**: alto volume, mas site oficial/comercial, provavel paywall/anti-bot e risco de muito trabalho por pouco ganho.
- **Wuxiaworld**: tambem oficial/comercial. Pode ser excelente para catalogo, mas nao e bom primeiro crawler.
- **Gravity Tales**: volume enorme, mas precisa verificar se representa um site real consistente hoje ou agregacao historica no NovelUpdates.
- **volarenovels**: acervo grande, mas parece legado. Bom para preservacao pontual, nao prioridade incremental.
- **Reaper Scans**: popular, mas provavelmente mais trabalhoso por Cloudflare e mistura com scans/manhwa.

## Proxima etapa proposta

1. Fazer probe direto nos sites dos principais candidatos: Hosted Novel, Sky Demon Order, Readhive, Golden Novel, Chrysanthemum Garden e Foxaholic.
2. Para cada um, confirmar:
   - se tem listagem HTML estatica ou API;
   - se exige JavaScript/Cloudflare;
   - se paginas de novel expõem capitulos;
   - se conteudo do capitulo vem em HTML limpo o suficiente;
   - se ha paywall/login.
3. Escolher o primeiro conector ingles pelo menor custo tecnico, nao apenas pelo maior volume.
