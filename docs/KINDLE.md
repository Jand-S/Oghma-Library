# Kindle: conversão, detecção e envio

O app converte o EPUB para AZW3 e manda para o Kindle por cabo (USB ou MTP) ou sem fio, pelo
app "Send to Kindle" da Amazon. O código fica em `apps/desktop/src-tauri/src/kindle.rs`, com o
MTP em `kindle_mtp.rs` (Windows) e `kindle_mtp_mac.rs` (macOS).

## Conversão EPUB → AZW3

- **Conversor principal:** Kindling (crate `kindling-mobi`, vendorizado em
  `vendor/kindling-mobi`). Roda dentro do app, sem programa externo.
  - Instala a capa local no EPUB.
  - Converte imagens que o Kindle não aceita.
  - Gera um content id estável por livro.
- **Reserva:** o Calibre (`ebook-convert` no PATH), usado só se o Kindling falhar.
- **Grava em arquivo temporário** e troca no fim; o AZW3 é refeito sempre que o EPUB for mais
  novo (`ensure_fresh_azw3`).
- **Comando:** `convert_export_to_azw3`.

## Detecção (`detect_kindle`)

Roda fora da thread principal. O app chama a cada poucos segundos.

- **USB:** procura um aparelho com o Vendor ID da Amazon/Lab126 (`0x1949`) via `nusb`.
- **Disco montado (Kindles antigos):** olha os volumes de cada sistema (letras `D:`–`Z:` no
  Windows, `/Volumes` no macOS, `/media` e `/run/media` no Linux). Só aceita um volume que
  tenha **as pastas `documents` e `system`**. Antes, qualquer HD com uma pasta "Documents"
  passava por Kindle.
- **`transport` devolvido ao app:**
  - `mass_storage` — achou a pasta `documents`; a cópia é direta.
  - `mtp` — achou o aparelho, mas não um disco (Kindles de 2021 em diante).
  - `none` — nada conectado.
- **Sem fio:** `wirelessAvailable` diz se o "Send to Kindle" para Mac está instalado.
  - O caminho do app fica em cache por 1 minuto, porque a busca no Spotlight (`mdfind`) é um
    processo externo.
  - `wirelessSupported` só é verdadeiro no macOS.

## Envio

- **Disco montado:** copia o AZW3 para `documents` e instala a miniatura da capa em
  `system/thumbnails`.
- **MTP:** abre uma sessão por envio, acha `documents` e `system/thumbnails` no primeiro
  armazenamento e substitui o arquivo de mesmo nome.
  - No macOS, um cliente PTP/MTP próprio sobre o `nusb`.
  - No Windows, via WPD.
  - No Linux, ainda não há envio por MTP.
- **Sem fio (macOS):** `kindle_send_wireless` abre os EPUBs no app "Send to Kindle", que
  manda para a conta Amazon pelo Wi-Fi.
- **Segurança:** todos os comandos conferem se os livros estão dentro da pasta de saída
  (`ExportRoot`). A webview não consegue mandar ao Kindle um arquivo qualquer do disco.

## Ainda falta

- **Marcadores do Kindle** (o que já foi lido) não são lidos de volta para a Biblioteca.
- **MTP no Linux** (via `libmtp`).
