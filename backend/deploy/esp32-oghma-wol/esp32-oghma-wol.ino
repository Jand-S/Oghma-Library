#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <time.h>

// Ajuste antes de gravar na placa.
static const char* WIFI_SSID = "SEU_WIFI";
static const char* WIFI_PASSWORD = "SUA_SENHA_WIFI";

// Token compartilhado com /srv/oghma/.env.daily-crawl no servidor local.
static const char* CONTROL_TOKEN = "troque-este-token";

// Servidor local.
static const char* SERVER_HEALTH_URL = "http://192.168.0.42:8020/health";
static const char* SERVER_TRIGGER_URL = "http://192.168.0.42:8020/trigger";
static const IPAddress BROADCAST_IP(192, 168, 0, 255);
static const byte TARGET_MAC[6] = {0x0a, 0xe0, 0xaf, 0xa7, 0x01, 0xd1};

// Horario diario em America/Sao_Paulo. O ESP32 usa UTC-3 fixo.
static const int RUN_HOUR = 5;
static const int RUN_MINUTE = 10;
static const bool RUN_IF_BOOT_AFTER_SCHEDULE = true;
static const bool RUN_ON_BOOT_FOR_TEST = false;

static const unsigned long CHECK_INTERVAL_MS = 15000;
static const unsigned long SERVER_BOOT_TIMEOUT_MS = 20UL * 60UL * 1000UL;
static const unsigned int WOL_PORT = 9;

WiFiUDP udp;
unsigned long lastCheckAt = 0;
int lastRunYear = -1;
int lastRunYday = -1;
bool bootTestAlreadyRan = false;

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.print("Conectando no Wi-Fi ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());
}

void syncClock() {
  configTime(-3 * 3600, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
  Serial.print("Sincronizando relogio");
  struct tm timeInfo;
  while (!getLocalTime(&timeInfo)) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.println(&timeInfo, "Hora local: %Y-%m-%d %H:%M:%S");
}

bool httpOk(const char* url) {
  HTTPClient http;
  http.setTimeout(5000);
  http.begin(url);
  int code = http.GET();
  http.end();
  return code >= 200 && code < 300;
}

void sendWakeOnLan() {
  byte packet[102];

  for (int i = 0; i < 6; i++) {
    packet[i] = 0xFF;
  }

  for (int block = 1; block <= 16; block++) {
    for (int i = 0; i < 6; i++) {
      packet[block * 6 + i] = TARGET_MAC[i];
    }
  }

  Serial.println("Enviando Wake-on-LAN para 192.168.0.42...");
  for (int attempt = 0; attempt < 8; attempt++) {
    udp.beginPacket(BROADCAST_IP, WOL_PORT);
    udp.write(packet, sizeof(packet));
    udp.endPacket();
    delay(300);
  }
  Serial.println("Magic packets enviados.");
}

bool waitForServer() {
  unsigned long start = millis();
  while (millis() - start < SERVER_BOOT_TIMEOUT_MS) {
    if (httpOk(SERVER_HEALTH_URL)) {
      Serial.println("Servidor local respondeu.");
      return true;
    }
    delay(5000);
  }
  Serial.println("Timeout esperando servidor local.");
  return false;
}

bool triggerDailyCrawl(bool shutdownWhenDone) {
  String url = String(SERVER_TRIGGER_URL) + "?shutdownWhenDone=" + (shutdownWhenDone ? "1" : "0");
  HTTPClient http;
  http.setTimeout(10000);
  http.begin(url);
  http.addHeader("X-Oghma-Control-Token", CONTROL_TOKEN);

  int code = http.POST("");
  String payload = http.getString();
  http.end();

  Serial.print("Trigger HTTP ");
  Serial.print(code);
  Serial.print(": ");
  Serial.println(payload);

  return code == 202 || code == 409;
}

bool shouldRunToday(struct tm& timeInfo) {
  if (timeInfo.tm_year == lastRunYear && timeInfo.tm_yday == lastRunYday) {
    return false;
  }

  bool exactWindow = timeInfo.tm_hour == RUN_HOUR && timeInfo.tm_min == RUN_MINUTE;
  bool afterSchedule = RUN_IF_BOOT_AFTER_SCHEDULE &&
    (timeInfo.tm_hour > RUN_HOUR || (timeInfo.tm_hour == RUN_HOUR && timeInfo.tm_min >= RUN_MINUTE));

  return exactWindow || afterSchedule;
}

void runDailyFlow() {
  bool serverAlreadyOnline = httpOk(SERVER_HEALTH_URL);
  if (!serverAlreadyOnline) {
    sendWakeOnLan();
    if (!waitForServer()) {
      return;
    }
  }

  bool ok = triggerDailyCrawl(!serverAlreadyOnline);
  if (!ok) {
    Serial.println("Falha ao disparar rotina diaria.");
    return;
  }

  struct tm timeInfo;
  if (getLocalTime(&timeInfo)) {
    lastRunYear = timeInfo.tm_year;
    lastRunYday = timeInfo.tm_yday;
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  connectWifi();
  udp.begin(WOL_PORT);
  syncClock();
}

void loop() {
  connectWifi();

  if (RUN_ON_BOOT_FOR_TEST && !bootTestAlreadyRan) {
    bootTestAlreadyRan = true;
    Serial.println("RUN_ON_BOOT_FOR_TEST ativo: iniciando rotina diaria agora.");
    runDailyFlow();
    delay(1000);
    return;
  }

  unsigned long now = millis();
  if (now - lastCheckAt < CHECK_INTERVAL_MS) {
    delay(500);
    return;
  }
  lastCheckAt = now;

  struct tm timeInfo;
  if (!getLocalTime(&timeInfo)) {
    syncClock();
    return;
  }

  if (shouldRunToday(timeInfo)) {
    Serial.println(&timeInfo, "Iniciando rotina diaria: %Y-%m-%d %H:%M:%S");
    runDailyFlow();
  }
}
