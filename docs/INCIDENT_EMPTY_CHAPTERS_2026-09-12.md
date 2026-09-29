# Capitulos vazios: diagnostico e recuperacao

Data local: 12/09/2026. O servidor registra os horarios em UTC (13/09).

## Soberano dos Tres Reinos

Fonte: Novel Mania. ID: `novel-mania:soberano-dos-tres-reinos`.

- O EPUB local tem 481 entradas de capitulos. A numeracao de arquivos do EPUB
  e sequencial e nao coincide necessariamente com o numero do capitulo no site.
- O banco e o bundle B2 v1 tinham 76 capitulos com HTML de zero bytes,
  incluindo 50-53 e 74-77. Eles estavam marcados como `downloaded=true`.
- As respostas originais, salvas em 19/06/2026, contem
  `Rate limit exceeded. Try again later.` no estado serializado do site.
  O HTTP externo foi aceito, mas o conteudo de leitura estava ausente.
- O crawler nao validava o resultado e o incremental pulava registros existentes.
- Os 76 capitulos foram recuperados no servidor nesta investigacao, sem falhas.
  Backups e relatorio estao em:
  `/srv/oghma/files/reports/repair-empty-soberano-dos-tres-reinos-20260913-012243/`.
- Publicacao prioritaria concluida: o catalogo publico aponta para o bundle
  `soberano-dos-tres-reinos.v2.tar.gz`. Foi baixado novamente do B2 e validado:
  **481 capitulos, nenhum vazio**. Capitulos 50-53 e 74-77 contêm texto.

Portanto, os capitulos citados ja chegavam vazios do acervo publicado; a
geracao do EPUB nao causou a perda desse texto.

Separadamente, 29 documentos XHTML do EPUB tinham `<hr>` sem fechamento XML.
O exportador foi corrigido para serializar HTML como XHTML, incluindo entidades
e elementos vazios. Arquivos EPUB/AZW3 antigos precisam ser gerados novamente.

## Auditoria das fontes

A consulta selecionou contagem de palavras zero, caminho de conteudo nulo ou
hash de conteudo vazio. Cada candidato teve seu HTML examinado: capitulos com
imagens foram preservados. Isso nao e uma revisao semantica de cada capitulo
do acervo nem uma verificacao de todos os arquivos de todas as fontes.

Resultado apos recuperar Soberano dos Tres Reinos:

| Fonte | Capitulos vazios | Novels afetadas | Observacao |
| --- | ---: | ---: | --- |
| Novel Mania | 4430 | 264 | 4429 respostas com rate limit; 1 outro caso |
| Central Novel | 1 | 1 | Container de leitura vazio no HTML bruto |
| Mahou Reader | 10 | 7 | 6 sem texto no payload; 4 paginas de ilustracoes sem imagens preservadas |
| RoliaScan | 7 | 1 | `.reader-text` contendo quebras de linha sem texto |
| House Saikai | 0 | 0 | Os 8 candidatos sao capitulos ilustrados |
| Golden Novel | 0 | 0 | Nenhum candidato pelos criterios consultados |
| Sky Demon Order | 0 | 0 | Nenhum candidato pelos criterios consultados |

No Novel Mania, outros 59 registros sem palavras continham imagens e nao
foram classificados como vazios. A contagem inicial de 4565 registros sem
palavras incluia esses 59 e os 76 ja recuperados: 4565 - 59 - 76 = 4430.

Lista completa de novels, capitulos, URLs e classificacao:
[empty-chapters-audit-2026-09-12.json](empty-chapters-audit-2026-09-12.json).

### Casos das outras fontes

- Central Novel: Battle Through the Heavens, capitulo 270.
- Mahou Reader: Strongest Abandoned Son 1024; Super Gene 2264;
  The Author's POV 362-365. O payload salvo desses seis nao traz texto.
- Mahou Reader, paginas de ilustracoes: No Game No Life 0;
  Playing Death Games to Put Food on the Table 0; Sword Art Online 0;
  The Water Magician (LN) 0. Reprocessar o HTML bruto em memoria recupera
  referencias a imagens, mas sera necessario conferir e recuperar os assets.
- RoliaScan: Blood Warlock: Succubus Partner In The Apocalypse,
  capitulos 785, 789, 792, 793, 795, 806 e 807.
- Novel Mania: Nano Machine 52 e o unico vazio restante sem a mensagem
  de rate limit no bruto. Tambem foi incluido na fila de recuperacao.

Esses achados nao demonstram que todas as fontes tenham a mesma causa.
Os dados das outras fontes nao foram modificados nesta rodada.

## Correcoes e execucao

- Novel Mania: intervalo padrao de 3,5 segundos; validacao de conteudo;
  ate quatro tentativas para paginas vazias/rate limit com esperas de 15,
  30 e 60 segundos. Capitulo somente com imagem continua permitido.
- O conector foi atualizado no codigo do servidor e a imagem `oghma-crawler`
  foi reconstruida para os proximos crons.
- Desktop: XHTML produzido com DOMParser/XMLSerializer; exportacao interrompida
  com mensagem e numeros dos capitulos quando o intervalo solicitado tem vazios.
- `backend/deploy/audit-empty-chapters.py`: auditoria somente leitura.
- `backend/deploy/repair-novel-mania-empty.py`: recuperacao com backup de arquivo
  bruto, conteudo e registro de banco, relatorio por obra e commits por capitulo.
  Preserva os capitulos validos e as paginas ilustradas.
- Recuperacao geral: container `oghma-repair-novel-mania-empty`, run **625**.
  Processa 4430 capitulos em 264 novels e usa o mesmo lock da fonte no cron.
  Cinco falhas consecutivas interrompem a rotina para revisao.
- Publicacao final autorizada pelo usuario: container
  `oghma-publish-after-novel-mania-repair`, usando
  `backend/deploy/publish-after-repair.py`. Aguarda o run 625 terminar;
  nao publica se o reparo for interrompido. Usa o lock da rotina diaria.
- Foi autorizada tambem a publicacao incremental das tres atualizacoes
  previamente pendentes: Imortal Renegado; Jogando Jogos de Morte para Colocar
  Comida na Mesa; O Retorno do Jogador Congelado.

Estimativa inicial do reparo geral: cerca de 5 horas apenas de intervalo entre
requisicoes, mais tempo de processamento e eventuais retries.

## Monitoramento

- Monitor: http://192.168.0.42:8010/monitor
- Progresso JSON: http://192.168.0.42:8010/api/crawls?limit=5
- Logs: `docker logs -f oghma-repair-novel-mania-empty`
- Publicacao final: `docker logs -f oghma-publish-after-novel-mania-repair`
- Relatorios/backup no host: `/srv/oghma/files/reports/`.
  Dentro dos containers: `/srv/oghma/reports/`.

O EPUB antigo nao e atualizado automaticamente: depois da publicacao,
atualize o catalogo no desktop e baixe/gere novamente o livro para o Kindle.

## Validacao

- 11 testes do conector Novel Mania passaram, incluindo rate limit em HTTP 200,
  rejeicao de vazio, preservacao de imagens e limite de tentativas.
- 9 testes do downloadManager passaram, incluindo XHTML valido e bloqueio de
  capitulos vazios somente dentro do intervalo escolhido.
- `tsc --noEmit` passou. Nenhum executavel foi gerado.
