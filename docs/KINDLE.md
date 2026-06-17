# Kindle: detecção e envio (AZW3)

## Problema
A detecção antiga varria letras de drive (`D:\documents`..`Z:\documents`). Isso só funciona
com Kindles **antigos** (USB Mass Storage). Os **Kindles novos (2021+: Paperwhite 11ª gen,
Scribe, etc.) usam MTP** — aparecem como "dispositivo portátil", sem letra de unidade — então
nunca eram encontrados.

## Detecção (implementado — universal)
`detect_kindle` (Rust, `src-tauri/src/lib.rs`) agora usa **`nusb`** para enumerar USB e checar o
**Vendor ID da Amazon/Lab126 = `0x1949`**. Isso detecta **antigo e novo**, em qualquer SO,
independente de como monta. Em paralelo ainda procura a pasta `documents` por letra de drive.

Campo `transport` retornado ao frontend (`KindleDeviceStatus.transport`):
- `mass_storage` — achou drive com `documents` → cópia direta funciona (Kindle antigo / modo MSC).
- `mtp` — VID detectado mas sem drive → Kindle novo (precisa WPD no Windows).
- `none` — nada conectado.

Dependência adicionada em `Cargo.toml`: `nusb = "0.1"`.

## Envio
- **Mass Storage (antigo):** implementado — converte EPUB→AZW3 via `ebook-convert` (Calibre) e
  copia para `<drive>:\documents`.
- **MTP (novo):** ainda **não** envia — retorna erro claro. Próximo passo é **WPD**.

## WPD (Windows Portable Devices) — plano para o envio MTP no Windows
Implementar em módulo separado `src-tauri/src/kindle_mtp.rs`, atrás de `#[cfg(target_os = "windows")]`.
Dependência: crate `windows` com features `Win32_Devices_PortableDevices`, `Win32_System_Com`,
`Win32_System_Com_StructuredStorage`, `Win32_Foundation`, `Win32_UI_Shell_PropertiesSystem`.

Sequência COM (resumo):
1. `CoInitializeEx` (apartment/multithread).
2. `IPortableDeviceManager::GetDevices` → para cada device id, `GetDeviceFriendlyName` →
   achar o que contém "Kindle".
3. `IPortableDevice::Open` com `IPortableDeviceValues` de cliente.
4. `IPortableDevice::Content` → `IPortableDeviceContent`.
5. Navegar até a pasta `documents`: a partir de `WPD_DEVICE_OBJECT_ID` ("DEVICE"), enumerar
   filhos (`EnumObjects`) lendo `WPD_OBJECT_NAME`/`WPD_OBJECT_ORIGINAL_FILE_NAME` até achar o
   storage e dentro dele `documents` (case-insensitive; atenção a nomes localizados).
6. Criar o arquivo: `IPortableDeviceContent::CreateObjectWithPropertiesAndData` com
   `IPortableDeviceValues` (parent id, `WPD_OBJECT_NAME`, `WPD_OBJECT_ORIGINAL_FILE_NAME`,
   `WPD_OBJECT_SIZE`, `WPD_OBJECT_CONTENT_TYPE = WPD_CONTENT_TYPE_GENERIC_FILE`) → obtém
   `IStream` → escrever os bytes em blocos → `Commit`.
7. `CoUninitialize`.

> ⚠️ É COM puro/`unsafe`, frágil e **só Windows**. Vai exigir compilar e iterar na máquina
> (não dá pra validar no ambiente do agente). Recomenda-se gate por feature `mtp` no Cargo para
> não travar o build enquanto estabiliza.

## Alternativa / futuro
- **"Send to Kindle" por e-mail** (universal, sem fio, todos os modelos): enviar o AZW3/EPUB para
  o endereço `@kindle.com` da conta via SMTP (crate `lettre`). Precisa de UI p/ e-mail + remetente
  aprovado na Amazon. Bom fallback quando `transport == "mtp"` e não há WPD.
- **MTP em outros SOs (futuro):** Linux via `libmtp`; macOS via `ImageCaptureCore`/`libmtp`.
  Por ora, MTP é Windows-only (WPD).

## Pré-requisito de conversão
`ebook-convert` (Calibre) precisa estar no PATH para gerar AZW3. `detect_kindle` reporta
`converterAvailable`.
