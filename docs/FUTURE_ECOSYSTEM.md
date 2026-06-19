# Futuro do ecossistema Oghma

## Contexto

O Oghma nasceu primeiro como uma ferramenta local para buscar novels, organizar downloads e gerar arquivos para leitura no Kindle. Ao mesmo tempo, surgiram ideias de expandir o projeto para um ecossistema maior com:

- app mobile
- versao web
- contas
- biblioteca compartilhavel
- recomendacoes entre amigos
- leitura e audio dentro do proprio sistema

Este documento organiza essas ideias para guiar decisoes futuras sem misturar a visao de longo prazo com o roadmap imediato.

## Objetivo de produto

Construir um ecossistema em que o usuario possa:

- descobrir novels
- baixar e organizar sua biblioteca
- enviar para Kindle
- acompanhar leitura
- compartilhar favoritos e recomendacoes
- no futuro, ler ou ouvir diretamente no app

## Visao de longo prazo

O produto pode evoluir para quatro superficies conectadas:

1. `Desktop`
   Hoje e a superficie principal para biblioteca local, downloads, exportacao e Kindle.

2. `Backend`
   Passa a ser a fonte central de identidade, perfil, dados sociais e, se desejado no futuro, sincronizacao entre dispositivos.

3. `Web`
   Serve como primeiro passo para acesso remoto, inclusive no iPhone, sem exigir app nativo desde o inicio.

4. `Mobile`
   Fase futura para leitura, audio, favoritos, progresso e biblioteca no bolso.

## Dois caminhos possiveis

### Caminho A: ecossistema completo com sincronizacao real

Caracteristicas:

- conta unica para desktop, web e mobile
- biblioteca refletida entre dispositivos
- progresso de leitura sincronizado
- downloads e status compartilhados
- base para leitor proprio e audiobook com continuidade entre devices

Vantagens:

- experiencia mais forte e moderna
- excelente para leitura no celular
- prepara bem social, recomendacoes e audio

Custos:

- backend mais complexo
- resolucao de conflitos entre dispositivos
- offline sync
- autenticacao, seguranca e observabilidade mais robustas

### Caminho B: local-first com camada social

Caracteristicas:

- downloads e progresso ficam no cliente
- conta serve para perfil, favoritos, listas e recomendacoes
- cada dispositivo pode manter seu proprio estado local
- o servidor guarda apenas metadados sociais e snapshots opcionais

Vantagens:

- escopo menor
- entrega valor rapido
- preserva o foco principal em Kindle e organizacao pessoal
- reduz a pressao de resolver sincronizacao completa cedo demais

Custos:

- desktop e mobile nao compartilham tudo automaticamente
- progresso pode divergir entre dispositivos
- menos sensacao de "ecossistema unico" no curto prazo

## Recomendacao atual

Para o momento atual do projeto, o melhor caminho e seguir com `Caminho B: local-first com camada social`.

Motivos:

- o uso principal ainda e baixar no computador e ler no Kindle
- sincronizacao completa puxaria muita complexidade agora
- ainda assim da para criar valor com contas, perfil, favoritos e recomendacoes
- esse caminho nao bloqueia uma migracao futura para sync real

Em outras palavras:

- `agora`: experiencia local excelente + camada social
- `depois`: sync real, leitor compartilhado e continuidade entre dispositivos

## Funcionalidades sugeridas por fase

### Fase 1: base social leve

- contas
- login no desktop e web
- perfil simples
- favoritos
- status de leitura: `quero ler`, `lendo`, `pausado`, `concluido`
- recomendacoes entre amigos
- biblioteca publica ou parcialmente publica

### Fase 2: leitura e biblioteca expandida

- web responsiva
- biblioteca remota por conta
- leitor proprio na web/mobile
- bookmarks e historico
- progresso opcional enviado para o perfil

### Fase 3: experiencia rica de leitura

- app mobile
- leitura offline
- sincronizacao parcial ou completa
- comentarios pessoais, notas e destaques
- descobrir novels via amigos e listas

### Fase 4: audio

- audiobook por obra
- player proprio
- continuar ouvindo de onde parou
- no futuro, sincronizar texto e audio

## Funcionalidades que fazem sentido no ecossistema

- `Continuar lendo`
- `Favoritos`
- `Colecoes`
- `Quero ler`
- `Lendo agora`
- `Recomendado por amigo`
- `Perfil publico opcional`
- `Biblioteca publica opcional`
- `Historico de leitura`
- `Audiobook player`
- `Notificacao de novos capitulos` para obras favoritada

## Como isso pode funcionar com os recursos atuais

### B2

Boa opcao para guardar:

- capas
- EPUB
- TXT/HTML exportados
- assets de capitulo
- futuros arquivos de audio

### SQLite

Bom para:

- cache local do desktop
- progresso local
- estado do download
- biblioteca local

No curto prazo ele tambem pode sustentar um backend pequeno, mas, se contas e social crescerem, a tendencia natural e migrar o backend online para PostgreSQL.

### Backend atual

O backend pode evoluir em duas etapas:

1. `Agora`
   Guardar usuarios, favoritos, listas, recomendacoes e preferencias basicas.

2. `Depois`
   Virar a fonte central de biblioteca, progresso e sincronizacao entre dispositivos.

## Modelo recomendado no curto prazo

`Local-first com cloud opcional`

Significa:

- o desktop continua sendo soberano para downloads e Kindle
- o celular e a web podem existir sem exigir sync total
- o servidor guarda apenas o que precisa para a camada social
- progresso pode ser privado/local por padrao e enviado apenas se o usuario quiser

## Modelo recomendado no longo prazo

`Estado central + eventos`

Se o projeto amadurecer para sync real, a melhor arquitetura tende a ser:

- clientes geram eventos
- servidor consolida o estado da conta
- outros clientes refletem esse estado
- jobs ficam reservados para tarefas pesadas, retries e reparos

Exemplos de eventos:

- `library_add`
- `favorite_toggle`
- `reading_progress_update`
- `recommendation_send`
- `download_registered`

## Riscos e cuidados

- autenticacao aumenta a responsabilidade de seguranca
- sync bidirecional aumenta bastante a complexidade
- leitor proprio exige UX caprichada
- audiobook aumenta custo de storage e processamento
- recursos sociais pedem configuracoes de privacidade desde cedo

## Decisao sugerida para quando retomarmos

Se a prioridade continuar sendo Kindle e organizacao pessoal:

1. melhorar o desktop
2. adicionar contas
3. criar perfil, favoritos e recomendacoes
4. lancar web responsiva
5. decidir depois se vale app mobile nativo ou sync completo

Se a prioridade mudar para leitura diaria no celular:

1. criar backend central
2. fazer web/mobile primeiro
3. implementar leitor proprio
4. so depois aprofundar Kindle e exportacoes

## Resumo

O Oghma pode crescer para um ecossistema muito interessante, mas a melhor estrategia hoje e nao tentar resolver tudo de uma vez.

Direcao sugerida:

- manter o desktop como nucleo
- adicionar uma camada social primeiro
- tratar sincronizacao completa como uma fase futura
- usar a web como ponte natural para iOS antes de assumir o custo de app nativo
