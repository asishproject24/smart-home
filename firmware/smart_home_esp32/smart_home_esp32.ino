/* ─────────────────────────────────────────────────────────────
   SMART HOME CONTROL SYSTEM — ESP32 Firmware
   Matches the "Overview" dashboard:
     • Temperature + Humidity  (DHT11)
     • LDR (Lux)               (analog light sensor)
     • Room Light              (relay ON/OFF)
     • Fan                     (12 V DC motor via L298N, PWM speed 0-100%)
     • Automatic / Manual mode
   Talks to the Django backend:
     POST /api/telemetry/  -> sends readings every 3 s, receives device state
     GET  /api/control/    -> polled every 0.4 s so manual ON/OFF from the
                              dashboard reaches the relay almost instantly
   -----------------------------------------------------------------
   Libraries (install via Arduino Library Manager):
     • "DHT sensor library" by Adafruit  (+ Adafruit Unified Sensor)
     • "ArduinoJson" by Benoit Blanchon  (v6 or v7)
   Board: "ESP32 Dev Module"
   ───────────────────────────────────────────────────────────── */

#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include "secrets.h"        // Wi-Fi credentials (git-ignored; see secrets.example.h)

/* ══════════════ 1. CONFIG — EDIT THESE ══════════════ */
const char* WIFI_SSID = WIFI_SSID_SECRET;
const char* WIFI_PASS = WIFI_PASS_SECRET;

// Django server address. Use your PC's LAN IP (run `ipconfig` / `ip addr`),
// NOT 127.0.0.1 — the ESP32 needs to reach your computer over the network.
// No trailing slash.
// LOCAL  : "http://10.250.164.58:8000"           (laptop LAN IP)
// ONLINE : "http://USERNAME.pythonanywhere.com"   (PythonAnywhere, plain http — no cert needed)
const char* SERVER_BASE = "http://10.250.164.58:8000";

const String TELEMETRY_URL = String(SERVER_BASE) + "/api/telemetry/";
const String CONTROL_URL   = String(SERVER_BASE) + "/api/control/";

/* ══════════════ 2. PIN MAP ══════════════ */
#define DHT_PIN     33      // DHT11 data
#define DHT_TYPE    DHT11
#define LDR_PIN     34     // LDR analog (ADC1, input-only)

// Which way the divider is wired decides whether the raw ADC value rises or
// falls in light. Set to false if bright light starts reading LOW lux again.
const bool LDR_INVERTED = true;
#define LIGHT_PIN   27     // Relay for Room Light

// ── Fan via L298N motor driver (DC motor only, NOT a 220 V AC fan) ──
#define FAN_PIN     25     // -> ENA  (PWM speed, remove the ENA jumper!)
#define FAN_IN1     26     // -> IN1  (direction)
#define FAN_IN2     13     // -> IN2  (direction)

/* ══════════════ 3. THRESHOLDS (local auto-mode fallback) ══════ */
const float TEMP_ON      = 30.0;   // fan turns on above this °C
const float TEMP_FULL    = 40.0;   // fan reaches 100% at this °C
const int   LIGHT_ON_LUX = 200;    // light turns on below this lux

/* ══════════════ 4. FAN PWM (LEDC) ══════════════ */
const int FAN_CH   = 0;
const int FAN_FREQ = 5000;    // 5 kHz — the L298N cannot switch much faster
const int FAN_RES  = 8;       // 8-bit (0-255)
const int FAN_MIN_DUTY = 90;  // below this a DC motor just buzzes and stalls

/* ══════════════ 5. STATE ══════════════ */
DHT dht(DHT_PIN, DHT_TYPE);

bool  lightOn   = true;
bool  fanOn     = true;
int   fanSpeed  = 65;     // %
bool  autoMode  = true;

unsigned long lastSend = 0;
unsigned long lastPoll = 0;
const unsigned long SEND_EVERY = 3000;   // telemetry: read sensors + log to server
const unsigned long POLL_EVERY = 400;    // control: how fast manual commands land

/* ─────────────────────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(LIGHT_PIN, OUTPUT);

  // L298N: IN1/IN2 fix the rotation direction, ENA carries the PWM speed.
  pinMode(FAN_IN1, OUTPUT);
  pinMode(FAN_IN2, OUTPUT);
  digitalWrite(FAN_IN1, HIGH);         // swap these two if the fan spins backwards
  digitalWrite(FAN_IN2, LOW);

  ledcSetup(FAN_CH, FAN_FREQ, FAN_RES);
  ledcAttachPin(FAN_PIN, FAN_CH);

  dht.begin();
  analogReadResolution(12);            // 0-4095

  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  // ── Fast control poll — manual commands land within ~0.4 s ──
  if (millis() - lastPoll >= POLL_EVERY) {
    lastPoll = millis();
    fetchControl();
  }

  if (millis() - lastSend >= SEND_EVERY) {
    lastSend = millis();

    float temp = dht.readTemperature();
    float hum  = dht.readHumidity();
    if (isnan(temp)) temp = 0;
    if (isnan(hum))  hum  = 0;
    int   lux  = readLux();

    // ── Automatic mode: device decides locally ──
    if (autoMode) {
      lightOn = (lux < LIGHT_ON_LUX);
      if (temp > TEMP_ON) {
        fanOn    = true;
        fanSpeed = map((int)constrain(temp, TEMP_ON, TEMP_FULL),
                       (int)TEMP_ON, (int)TEMP_FULL, 40, 100);
      } else {
        fanOn    = false;
        fanSpeed = 0;
      }
    }

    applyOutputs();
    sendTelemetry(temp, hum, lux);
  }
}

/* ── Wi-Fi ── */
void connectWiFi() {
  Serial.printf("Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(400); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("\n[OK] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
  else
    Serial.println("\n[!!] WiFi failed, will retry.");
}

/* ── LDR -> approx lux (calibrate for your divider) ── */
int readLux() {
  int raw = analogRead(LDR_PIN);          // 0-4095
  int lux = LDR_INVERTED ? map(raw, 0, 4095, 1000, 0)   // raw falls in light
                         : map(raw, 0, 4095, 0, 1000);  // raw rises in light
  Serial.printf("[ldr] raw=%4d -> %4d lux\n", raw, constrain(lux, 0, 1000));
  return constrain(lux, 0, 1000);
}

/* ── Drive relay + fan PWM ── */
void applyOutputs() {
  digitalWrite(LIGHT_PIN, lightOn ? HIGH : LOW);

  int duty = 0;
  if (fanOn && fanSpeed > 0) {
    // Scale 1-100 % into FAN_MIN_DUTY..255 so even 1 % actually turns the motor.
    duty = map(fanSpeed, 1, 100, FAN_MIN_DUTY, 255);
  }
  ledcWrite(FAN_CH, duty);
}

/* ── Signal strength % from RSSI ── */
int signalPct() {
  if (WiFi.status() != WL_CONNECTED) return 0;
  int rssi = WiFi.RSSI();               // ~ -30 (great) .. -90 (poor)
  return constrain(2 * (rssi + 100), 0, 100);
}

/* ── Server is the source of truth for mode + manual targets.
      Returns true (and drives the outputs) only when something changed. ── */
bool applyServerState(JsonDocument& in) {
  bool prevLight = lightOn, prevFan = fanOn, prevAuto = autoMode;
  int  prevSpeed = fanSpeed;

  autoMode = in["auto_mode"] | autoMode;
  if (!autoMode) {                       // manual: obey server
    lightOn  = in["light_on"]  | lightOn;
    fanOn    = in["fan_on"]    | fanOn;
    fanSpeed = in["fan_speed"] | fanSpeed;
  }

  bool changed = (lightOn != prevLight || fanOn != prevFan ||
                  fanSpeed != prevSpeed || autoMode != prevAuto);
  if (changed) applyOutputs();           // switch the relay immediately
  return changed;
}

/* ── GET the wanted device state (cheap, no DB write on the server) ── */
void fetchControl() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.setConnectTimeout(1000);          // don't stall the loop if server is down
  http.setTimeout(1000);
  http.begin(CONTROL_URL);
  int code = http.GET();

  if (code == 200) {
    StaticJsonDocument<320> in;
    if (deserializeJson(in, http.getString()) == DeserializationError::Ok) {
      if (applyServerState(in))
        Serial.printf("[ctrl] light=%d fan=%d/%d%% %s\n",
                      lightOn, fanOn, fanSpeed, autoMode ? "AUTO" : "MANUAL");
    }
  }
  http.end();
}

/* ── POST telemetry, read back device state ── */
void sendTelemetry(float temp, float hum, int lux) {
  if (WiFi.status() != WL_CONNECTED) return;

  StaticJsonDocument<320> doc;
  doc["temperature"] = temp;
  doc["humidity"]    = hum;
  doc["ldr"]         = lux;
  doc["fan_speed"]   = fanSpeed;
  doc["light_on"]    = lightOn;
  doc["fan_on"]      = fanOn;
  doc["auto_mode"]   = autoMode;
  doc["signal"]      = signalPct();
  doc["uptime_ms"]   = millis();

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.setConnectTimeout(1500);
  http.setTimeout(1500);
  http.begin(TELEMETRY_URL);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);

  if (code == 200) {
    String resp = http.getString();
    StaticJsonDocument<320> in;
    if (deserializeJson(in, resp) == DeserializationError::Ok)
      applyServerState(in);
    Serial.printf("[%d] T=%.1f H=%.0f L=%d  light=%d fan=%d/%d%% %s\n",
                  code, temp, hum, lux, lightOn, fanOn, fanSpeed,
                  autoMode ? "AUTO" : "MANUAL");
  } else {
    Serial.printf("POST failed: %d\n", code);
  }
  http.end();
}
