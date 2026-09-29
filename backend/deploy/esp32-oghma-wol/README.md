# ESP32 Oghma Wake-on-LAN

Sketch para o ESP32 ser o agendador diario dos crawlers.

O fluxo atual nao precisa de VPS:

1. o ESP32 fica ligado 24/7;
2. ele sincroniza horario via NTP;
3. perto de 05:00 em America/Sao_Paulo, verifica se o servidor responde;
4. se o servidor estiver desligado, envia Wake-on-LAN;
5. quando o servidor responder, chama o control server local;
6. o servidor roda os crawlers finalizados e desliga ao final se foi acordado
   pelo ESP32.

## Configuracao no sketch

Antes de enviar para a placa, ajuste:

- `WIFI_SSID`
- `WIFI_PASSWORD`
- `CONTROL_TOKEN`
- `RUN_HOUR` e `RUN_MINUTE`, se quiser testar outro horario
- `RUN_ON_BOOT_FOR_TEST`, se quiser disparar uma unica vez assim que a placa ligar

O MAC do servidor local ja foi preenchido:

```text
0a:e0:af:a7:01:d1
```

O broadcast padrao esta como:

```text
192.168.0.255
```

## Endpoint esperado no servidor local

O sketch chama:

```text
GET  http://192.168.0.42:8020/health
POST http://192.168.0.42:8020/trigger?shutdownWhenDone=0|1
```

O sketch envia o header:

```text
X-Oghma-Control-Token: <CONTROL_TOKEN>
```

## Descobrir o IP do ESP32

Abra o Serial Monitor em `115200`. O sketch imprime o IP recebido via DHCP.
Para este fluxo, o IP do ESP32 nao precisa ser fixo, porque ele nao recebe
conexoes; ele so faz chamadas para o servidor local.

## Dependencias no servidor

O servidor local precisa estar com o control server ativo:

```bash
sudo cp /home/codex/oghma/deploy/oghma-control.service.example /etc/systemd/system/oghma-control.service
sudo systemctl daemon-reload
sudo systemctl enable --now oghma-control.service
```

O token deve ficar em `/srv/oghma/.env.daily-crawl`:

```bash
OGHMA_CONTROL_TOKEN=troque-este-token
DISCORD_BOT_TOKEN=...
DISCORD_USER_ID=...
```

## Teste recomendado

1. No sketch, coloque seu Wi-Fi e o mesmo token de `OGHMA_CONTROL_TOKEN`.
2. Para o primeiro teste, deixe:

```cpp
static const bool RUN_ON_BOOT_FOR_TEST = true;
```

3. Grave o ESP32 e abra o Serial Monitor em `115200`.
4. Com o servidor ligado, confirme que ele chama `/trigger?shutdownWhenDone=0`.
5. Depois volte:

```cpp
static const bool RUN_ON_BOOT_FOR_TEST = false;
```

6. Para testar Wake-on-LAN, desligue o servidor e use um horario temporario alguns
   minutos a frente em `RUN_HOUR`/`RUN_MINUTE`.
