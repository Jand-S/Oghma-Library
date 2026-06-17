# Setup de armazenamento: Backblaze B2 (+ Cloudflare)

Objetivo: ter um bucket S3-compativel onde o `oghma publish` sobe `index.json` + catalogos + bundles, e
(opcional) a Cloudflare na frente para egress gratis e um dominio bonito.

> Os numeros de regiao/endpoint variam por conta. **Sempre leia os valores reais na pagina do seu bucket**,
> nao confie nos exemplos abaixo.

## Parte 1 — Backblaze B2 (faca agora; desbloqueia o publish)

1. Crie conta no Backblaze e ative **B2 Cloud Storage**. Tem 10 GB gratis; o uso aqui e centavos/mes.
2. **Create a Bucket**:
   - Nome unico global (ex.: `oghma-acervo`; se ja existir, ponha um sufixo).
   - Files in Bucket: **Public** para comecar (servir via Cloudflare por CNAME exige publico).
     - Atencao: publico = qualquer um com a URL baixa. Para acervo pessoal, da para deixar privado depois
       usando um Cloudflare Worker (Parte 2, metodo B). Comece publico so para testar.
   - Default Encryption: pode habilitar (SSE-B2). Object Lock: off.
3. Abra os **detalhes do bucket** e anote:
   - **Endpoint** S3, tipo `s3.us-west-004.backblazeb2.com` (a regiao esta nele: `us-west-004`).
4. **App Keys -> Add a New Application Key**:
   - Nome: `oghma-publish`.
   - Allow access to Bucket(s): selecione **so** o `oghma-acervo`.
   - Type of Access: **Read and Write**.
   - Salve **keyID** e **applicationKey** na hora (a secret so aparece uma vez).
5. Variaveis que o `oghma publish` vai usar (S3-compativel via boto3) — no `.env` do servidor, **nunca commit**:
   ```
   OGHMA_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
   OGHMA_S3_REGION=us-west-004
   OGHMA_S3_BUCKET=oghma-acervo
   OGHMA_S3_ACCESS_KEY_ID=<keyID>
   OGHMA_S3_SECRET_ACCESS_KEY=<applicationKey>
   ```
6. Teste rapido (com as creds exportadas):
   ```bash
   # aws-cli
   aws s3 ls s3://oghma-acervo --endpoint-url https://s3.us-west-004.backblazeb2.com
   echo ok > t.txt && aws s3 cp t.txt s3://oghma-acervo/ --endpoint-url https://s3.us-west-004.backblazeb2.com
   ```
   (rclone tambem funciona: `rclone config` -> provider "Other"/"Backblaze B2" ou S3-compatible.)

Com isso o servidor ja consegue subir/descer arquivos. Sem Cloudflare, o B2 ja da **egress gratis ate 3x o
armazenado/mes** (acima disso US$ 0,01/GB) — para um projeto pequeno pode custar US$ 0.

## Parte 2 — Cloudflare na frente (egress gratis ilimitado + dominio)

Requisito: um **dominio gerenciado pela Cloudflare** (adicione o site na Cloudflare e troque os nameservers
no registrador; plano Free serve). O egress B2->Cloudflare so e gratis quando o trafego passa **proxied**
pela Cloudflare.

### Metodo A — CNAME + Transform Rule (simples, bucket publico)
1. Pegue a **friendly URL** do B2: abra um arquivo do bucket; a URL e tipo
   `https://f004.backblazeb2.com/file/oghma-acervo/arquivo`. O host e `f004.backblazeb2.com` (o numero casa
   com a regiao).
2. Cloudflare -> **DNS -> Add record**:
   - Type **CNAME**, Name `acervo` (vira `acervo.seudominio.com`), Target `f004.backblazeb2.com`,
     Proxy status **Proxied** (nuvem laranja). <- e o proxied que ativa a Bandwidth Alliance.
3. O B2 serve em `/file/<bucket>/...`, entao mapeie o caminho com **Rules -> Transform Rules -> Rewrite URL**:
   - When: hostname equals `acervo.seudominio.com`
   - Then: **Rewrite path** to (dynamic): `concat("/file/oghma-acervo", http.request.uri.path)`
   - Resultado: `acervo.seudominio.com/index.json` -> `/file/oghma-acervo/index.json`.
4. **Cache** (recomendado): como os arquivos sao imutaveis por versao, cacheie agressivo.
   Rules -> Cache Rules: para esse hostname, "Eligible for cache" + Edge TTL alto. (`index.json` e o unico
   mutavel; de a ele um TTL curto ou um cache-bypass por uma regra so para `/index.json`.)
5. Teste: `curl -I https://acervo.seudominio.com/index.json` deve responder 200 com header `cf-cache-status`.

### Metodo B — Cloudflare Worker (bucket privado, mais seguro)
Um Worker assina/proxia as requisicoes para um bucket **privado** (a secret fica no Worker, nada publico).
Mais setup; vale se voce nao quiser o bucket aberto. Deixar para quando a privacidade importar.

## Como isso entra no app

- A URL base do acervo passa a ser `https://acervo.seudominio.com` (ou a friendly URL do B2 se nao usar
  Cloudflare). No onboarding, e isso que vai no campo "servidor de index".
- O `StaticBundleBackendClient` baixa `…/index.json`, depois os catalogos por site e os bundles.

## Decisoes a tomar

- **Publico vs privado**: pessoal -> Worker/privado depois; so seu -> publico simples ja serve para testar.
- **R2 como alternativa**: se nao quiser configurar dominio/CNAME, o Cloudflare R2 da egress gratis nativo
  sem esse setup (storage 3x mais caro, mas centavos na sua escala). Mesmo `oghma publish`, so muda
  endpoint/creds.

## Instancia configurada (este projeto)

- Provider: **Backblaze B2**, regiao `us-east-005`.
- Endpoint S3: `https://s3.us-east-005.backblazeb2.com`
- Bucket: `oghma-acervo`
- Host de download B2: `f005.backblazeb2.com`
- Cloudflare (dominio `jandson.me`):
  - DNS: CNAME `b2` -> `f005.backblazeb2.com`, **Proxied**.
  - Transform Rule (Rewrite URL): se `http.host eq "b2.jandson.me"` -> path `concat("/file/oghma-acervo", http.request.uri.path)`.
  - Cache Rule geral: TTL longo (imutavel por versao); regra separada para `/index.json` com TTL curto/bypass.
- **URL base do acervo: `https://b2.jandson.me`** (campo "servidor de index" do app; `index.json` em `https://b2.jandson.me/index.json`).
- Env do `oghma publish` (no `.env` do servidor, nunca commit):
  `OGHMA_S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com`, `OGHMA_S3_REGION=us-east-005`,
  `OGHMA_S3_BUCKET=oghma-acervo`, `OGHMA_S3_ACCESS_KEY_ID=<keyID>`, `OGHMA_S3_SECRET_ACCESS_KEY=<applicationKey>`.

## Status (16/06/2026): VALIDADO

- `https://b2.jandson.me/teste.txt` -> 200 servindo o conteudo via Cloudflare (Transform Rule + CNAME proxied OK).
- Bucket `oghma-acervo` esta **publico** (a friendly URL le sem auth; erro de arquivo inexistente vem como 404 `not_found`, nao 401).
- Pendente: Cache Rules (opcional, otimizacao) e decisao publico-vs-privado.
