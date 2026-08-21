#include <HTTP_Method.h>
#include <Middlewares.h>
#include <Uri.h>
#include <WebServer.h>

/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║          PhysioPulse – ESP32 Firmware v1.0                          ║
 * ║          MYOSA 6.0 Competition – Physiotherapy Monitoring System    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Hardware:
 *   - MYOSA ESP32-WROVER Board (WiFi + BLE)
 *   - MYOSA MPU-6050 (GY-521) Sensor Board at I2C address 0x69
 *
 * Communication:
 *   - WiFi AP Mode: Creates hotspot "PhysioPulse-XXXX" / "physio123"
 *   - HTTP Server (port 80): Serves the PhysioPulse web app
 *   - WebSocket Server (port 81): Real-time JSON sensor stream at ~20 Hz
 *   - BLE GATT Server: Sensor data as BLE characteristics
 *
 * Web App:
 *   Stored in LittleFS flash filesystem and served via HTTP.
 *   Access at: http://192.168.4.1 or http://physiopulse.local
 *
 * Required Libraries (install via Arduino Library Manager):
 *   - WebSockets by Markus Sattler (v2.3.x)
 *   - ESPAsyncWebServer (or use the simple WiFiServer)
 *   - ArduinoJson by Benoit Blanchon (v6.x)
 *   - ESP32 BLE Arduino (built-in with ESP32 board package)
 *   - LittleFS (built-in with ESP32 board package)
 *
 * Board Settings in Arduino IDE:
 *   Board: "ESP32 Wrover Module" or "ESP32 Dev Module"
 *   Partition Scheme: "Default 4MB with spiffs" or "Huge APP (3MB No OTA/1MB SPIFFS)"
 *   Flash Size: 4MB
 *   Upload Speed: 115200 or 921600
 *
 * Upload Steps:
 *   1. Upload LittleFS data: Sketch > ESP32 LittleFS Data Upload (plugin needed)
 *   2. Upload firmware: Sketch > Upload
 */

// ─── Library Includes ──────────────────────────────────────────────────────
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include "webapp_data.h"
#include <ESPmDNS.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "mpu6050.h"

// ─── Configuration ─────────────────────────────────────────────────────────
#define WIFI_AP_SSID_PREFIX  "PhysioPulse"
#define WIFI_AP_PASSWORD     "physio123"
#define WIFI_CHANNEL         6
#define WIFI_MAX_CLIENTS     4

// Optional: Connect to existing WiFi network (leave blank to use AP-only mode)
#define STA_SSID    ""   // e.g., "HomeRouter"
#define STA_PASS    ""   // e.g., "routerpass"

#define HTTP_PORT   80
#define WS_PORT     81

// MPU-6050 I2C address (AD0 = HIGH on MYOSA board)
#define MPU_ADDR    0x69

// Sensor read interval in ms (50ms = 20 Hz)
#define SENSOR_INTERVAL_MS  50

// BLE UUIDs (custom service for PhysioPulse)
#define BLE_SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define BLE_CHAR_ACCEL_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26a1"
#define BLE_CHAR_GYRO_UUID      "beb5483e-36e1-4688-b7f5-ea07361b26a2"
#define BLE_CHAR_TEMP_UUID      "beb5483e-36e1-4688-b7f5-ea07361b26a3"
#define BLE_CHAR_JSON_UUID      "beb5483e-36e1-4688-b7f5-ea07361b26a4"

// I2C Pins (default on ESP32; adjust if different on MYOSA board)
#define I2C_SDA  21
#define I2C_SCL  22

// LED pin (onboard LED for status indication)
#define STATUS_LED  2

// ─── Global Objects ────────────────────────────────────────────────────────
MPU6050       mpu(MPU_ADDR);
WebServer     httpServer(HTTP_PORT);
WebSocketsServer wsServer(WS_PORT);

// BLE
BLEServer          *pBLEServer       = nullptr;
BLECharacteristic  *pCharAccel       = nullptr;
BLECharacteristic  *pCharGyro        = nullptr;
BLECharacteristic  *pCharTemp        = nullptr;
BLECharacteristic  *pCharJSON        = nullptr;
bool                bleDeviceConnected = false;

// State
struct SensorState {
  float accelX, accelY, accelZ;
  float gyroX,  gyroY,  gyroZ;
  float temperature;
  float gyroOffX = 0, gyroOffY = 0, gyroOffZ = 0;
  unsigned long timestamp = 0;
  bool calibrated = false;
} sensorState;

unsigned long lastSensorRead = 0;
uint8_t  wsClientCount = 0;

// ─── BLE Callbacks ─────────────────────────────────────────────────────────
class BLEServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    bleDeviceConnected = true;
    Serial.println("[BLE] Device connected");
    digitalWrite(STATUS_LED, HIGH);
  }
  void onDisconnect(BLEServer* pServer) {
    bleDeviceConnected = false;
    Serial.println("[BLE] Device disconnected, restarting advertising");
    pServer->startAdvertising();
    digitalWrite(STATUS_LED, LOW);
  }
};

// ─── Helper: Build JSON payload ────────────────────────────────────────────
String buildSensorJSON(bool pretty = false) {
  StaticJsonDocument<256> doc;
  doc["t"]  = sensorState.timestamp;
  doc["ax"] = serialized(String(sensorState.accelX, 4));
  doc["ay"] = serialized(String(sensorState.accelY, 4));
  doc["az"] = serialized(String(sensorState.accelZ, 4));
  doc["gx"] = serialized(String(sensorState.gyroX - sensorState.gyroOffX, 4));
  doc["gy"] = serialized(String(sensorState.gyroY - sensorState.gyroOffY, 4));
  doc["gz"] = serialized(String(sensorState.gyroZ - sensorState.gyroOffZ, 4));
  doc["tp"] = serialized(String(sensorState.temperature, 2));
  doc["cal"] = sensorState.calibrated;
  
  String out;
  if (pretty) serializeJsonPretty(doc, out);
  else        serializeJson(doc, out);
  return out;
}

// ─── HTTP Routes ───────────────────────────────────────────────────────────
void setupHTTPRoutes() {
  // Serve the bundled web app directly from memory (no LittleFS required!)
  httpServer.on("/", HTTP_GET, []() {
    httpServer.send_P(200, "text/html", webapp_html);
  });
  httpServer.on("/index.html", HTTP_GET, []() {
    httpServer.send_P(200, "text/html", webapp_html);
  });

  // REST API: Get latest sensor reading as JSON
  httpServer.on("/api/sensor", HTTP_GET, []() {
    httpServer.sendHeader("Access-Control-Allow-Origin", "*");
    httpServer.send(200, "application/json", buildSensorJSON(true));
  });

  // REST API: Get device info
  httpServer.on("/api/info", HTTP_GET, []() {
    StaticJsonDocument<256> doc;
    doc["device"] = "PhysioPulse";
    doc["version"] = "1.0.0";
    doc["sensor"] = "MPU-6050";
    doc["i2c_addr"] = MPU_ADDR;
    doc["mac"] = WiFi.macAddress();
    doc["ap_ip"] = WiFi.softAPIP().toString();
    if (strlen(STA_SSID) > 0) doc["sta_ip"] = WiFi.localIP().toString();
    doc["ws_port"] = WS_PORT;
    doc["uptime_s"] = millis() / 1000;
    doc["free_heap"] = ESP.getFreeHeap();
    String out;
    serializeJsonPretty(doc, out);
    httpServer.sendHeader("Access-Control-Allow-Origin", "*");
    httpServer.send(200, "application/json", out);
  });

  // REST API: Trigger gyro calibration
  httpServer.on("/api/calibrate", HTTP_POST, []() {
    mpu.calibrateGyro(sensorState.gyroOffX, sensorState.gyroOffY, sensorState.gyroOffZ);
    sensorState.calibrated = true;
    httpServer.sendHeader("Access-Control-Allow-Origin", "*");
    httpServer.send(200, "application/json", "{\"status\":\"calibrated\"}");
  });

  // Handle 404
  httpServer.onNotFound([]() {
    httpServer.send(404, "text/plain", "Not found: " + httpServer.uri());
  });
}

// ─── WebSocket Event Handler ───────────────────────────────────────────────
void onWebSocketEvent(uint8_t clientNum, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      IPAddress ip = wsServer.remoteIP(clientNum);
      Serial.printf("[WS] Client #%d connected from %s\n", clientNum, ip.toString().c_str());
      wsClientCount++;
      // Send welcome message with device info
      StaticJsonDocument<128> welcome;
      welcome["type"]   = "welcome";
      welcome["device"] = "PhysioPulse";
      welcome["rate_hz"] = 1000 / SENSOR_INTERVAL_MS;
      String msg;
      serializeJson(welcome, msg);
      wsServer.sendTXT(clientNum, msg);
      break;
    }
    case WStype_DISCONNECTED:
      Serial.printf("[WS] Client #%d disconnected\n", clientNum);
      if (wsClientCount > 0) wsClientCount--;
      break;
    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.printf("[WS] Message from client #%d: %s\n", clientNum, msg.c_str());
      // Handle commands from app
      if (msg == "calibrate") {
        mpu.calibrateGyro(sensorState.gyroOffX, sensorState.gyroOffY, sensorState.gyroOffZ);
        sensorState.calibrated = true;
        wsServer.sendTXT(clientNum, "{\"type\":\"calibrated\"}");
      } else if (msg == "ping") {
        wsServer.sendTXT(clientNum, "{\"type\":\"pong\"}");
      }
      break;
    }
    default:
      break;
  }
}

// ─── BLE Setup ────────────────────────────────────────────────────────────
void setupBLE() {
  // Create device name from MAC suffix
  String bleName = "PhysioPulse-" + WiFi.macAddress().substring(12);
  bleName.replace(":", "");

  BLEDevice::init(bleName.c_str());
  pBLEServer = BLEDevice::createServer();
  pBLEServer->setCallbacks(new BLEServerCallbacks());

  BLEService *pService = pBLEServer->createService(BLE_SERVICE_UUID);

  // Accelerometer characteristic (notify)
  pCharAccel = pService->createCharacteristic(
    BLE_CHAR_ACCEL_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharAccel->addDescriptor(new BLE2902());

  // Gyroscope characteristic (notify)
  pCharGyro = pService->createCharacteristic(
    BLE_CHAR_GYRO_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharGyro->addDescriptor(new BLE2902());

  // Temperature characteristic (notify)
  pCharTemp = pService->createCharacteristic(
    BLE_CHAR_TEMP_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharTemp->addDescriptor(new BLE2902());

  // Full JSON characteristic (notify) – for web Bluetooth
  pCharJSON = pService->createCharacteristic(
    BLE_CHAR_JSON_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharJSON->addDescriptor(new BLE2902());

  pService->start();

  // BLE Advertising
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

  Serial.printf("[BLE] Advertising as: %s\n", bleName.c_str());
}

// ─── Update BLE Characteristics ────────────────────────────────────────────
void updateBLE() {
  if (!bleDeviceConnected) return;

  // Pack accel as 3x float (12 bytes)
  float accelBuf[3] = {
    sensorState.accelX,
    sensorState.accelY,
    sensorState.accelZ
  };
  pCharAccel->setValue((uint8_t*)accelBuf, sizeof(accelBuf));
  pCharAccel->notify();

  // Pack gyro as 3x float (12 bytes)
  float gyroBuf[3] = {
    sensorState.gyroX - sensorState.gyroOffX,
    sensorState.gyroY - sensorState.gyroOffY,
    sensorState.gyroZ - sensorState.gyroOffZ
  };
  pCharGyro->setValue((uint8_t*)gyroBuf, sizeof(gyroBuf));
  pCharGyro->notify();

  // Temp as float (4 bytes)
  float temp = sensorState.temperature;
  pCharTemp->setValue((uint8_t*)&temp, sizeof(temp));
  pCharTemp->notify();

  // Full JSON string
  String json = buildSensorJSON(false);
  pCharJSON->setValue(json.c_str());
  pCharJSON->notify();
}

// ─── Setup ────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  
  Serial.println("\n╔══════════════════════════════════╗");
  Serial.println("║  PhysioPulse Firmware v1.0       ║");
  Serial.println("║  MYOSA 6.0 – Physiotherapy Hub   ║");
  Serial.println("╚══════════════════════════════════╝");

  // Status LED
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);

  // ── 1. Initialize I2C & MPU-6050
  Serial.println("\n[INIT] Starting I2C on SDA=21 SCL=22...");
  Wire.begin(I2C_SDA, I2C_SCL);
  
  // I2C scan
  Serial.println("[INIT] Scanning I2C bus...");
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("[INIT] I2C device found at 0x%02X\n", addr);
    }
  }
  
  if (!mpu.begin()) {
    Serial.println("[ERROR] MPU-6050 not found! Check wiring and I2C address.");
    Serial.println("[ERROR] Expected sensor at I2C address 0x69");
    // Blink LED rapidly to indicate error
    while (true) {
      digitalWrite(STATUS_LED, HIGH); delay(100);
      digitalWrite(STATUS_LED, LOW);  delay(100);
    }
  }
  Serial.println("[INIT] MPU-6050 initialized ✓");
  
  // Initial gyro calibration (sensor must be still)
  Serial.println("[INIT] Performing gyro calibration (keep sensor still for 2s)...");
  mpu.calibrateGyro(sensorState.gyroOffX, sensorState.gyroOffY, sensorState.gyroOffZ);
  sensorState.calibrated = true;
  Serial.println("[INIT] Gyro calibration done ✓");

  // ── 2. Web App Initialization
  Serial.println("\n[INIT] Using PROGMEM web app bundle (No LittleFS needed) ✓"); 

  // ── 3. WiFi Setup
  Serial.println("\n[INIT] Setting up WiFi...");
  
  // Generate unique SSID from MAC
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  String apSSID = String(WIFI_AP_SSID_PREFIX) + "-" + mac.substring(8);
  
  // Start AP mode
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(apSSID.c_str(), WIFI_AP_PASSWORD, WIFI_CHANNEL, 0, WIFI_MAX_CLIENTS);
  Serial.printf("[WiFi] AP Started: SSID=%s, IP=%s\n", apSSID.c_str(), WiFi.softAPIP().toString().c_str());
  
  // Optional: Connect to existing WiFi
  if (strlen(STA_SSID) > 0) {
    Serial.printf("[WiFi] Connecting to %s...\n", STA_SSID);
    WiFi.begin(STA_SSID, STA_PASS);
    int tries = 0;
    while (WiFi.status() != WL_CONNECTED && tries < 20) {
      delay(500);
      Serial.print(".");
      tries++;
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("\n[WiFi] Connected! STA IP: %s\n", WiFi.localIP().toString().c_str());
    } else {
      Serial.println("\n[WiFi] STA connection failed, AP-only mode");
    }
  }

  // ── 4. mDNS
  if (MDNS.begin("physiopulse")) {
    MDNS.addService("http", "tcp", HTTP_PORT);
    MDNS.addService("ws",   "tcp", WS_PORT);
    Serial.println("[mDNS] Started: http://physiopulse.local");
  }

  // ── 5. HTTP Server
  setupHTTPRoutes();
  httpServer.begin();
  Serial.printf("[HTTP] Server running on port %d\n", HTTP_PORT);

  // ── 6. WebSocket Server
  wsServer.begin();
  wsServer.onEvent(onWebSocketEvent);
  Serial.printf("[WS] WebSocket server on port %d\n", WS_PORT);

  // ── 7. BLE
  setupBLE();

  // Ready
  digitalWrite(STATUS_LED, HIGH);
  Serial.println("\n╔══════════════════════════════════════════════╗");
  Serial.println("║  PhysioPulse is READY!                       ║");
  Serial.printf( "║  WiFi SSID: %-32s ║\n", apSSID.c_str());
  Serial.println("║  Password: physio123                         ║");
  Serial.println("║  URL: http://192.168.4.1                     ║");
  Serial.println("║  URL: http://physiopulse.local               ║");
  Serial.printf( "║  WS:  ws://192.168.4.1:%d/                  ║\n", WS_PORT);
  Serial.println("╚══════════════════════════════════════════════╝\n");
}

// ─── Loop ────────────────────────────────────────────────────────────────
void loop() {
  // Handle HTTP requests
  httpServer.handleClient();
  
  // Handle WebSocket
  wsServer.loop();

  // Read sensor at defined interval
  unsigned long now = millis();
  if (now - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = now;
    
    MPU6050Data data = mpu.read();
    if (data.valid) {
      sensorState.accelX     = data.accelX;
      sensorState.accelY     = data.accelY;
      sensorState.accelZ     = data.accelZ;
      sensorState.gyroX      = data.gyroX;
      sensorState.gyroY      = data.gyroY;
      sensorState.gyroZ      = data.gyroZ;
      sensorState.temperature = data.temperature;
      sensorState.timestamp  = now;

      // Broadcast to all WebSocket clients
      if (wsClientCount > 0) {
        String json = buildSensorJSON(false);
        wsServer.broadcastTXT(json);
      }

      // Update BLE (throttle BLE to every 100ms = 10 Hz to avoid congestion)
      static unsigned long lastBLE = 0;
      if (now - lastBLE >= 100) {
        lastBLE = now;
        updateBLE();
      }
    }
  }
  
  // mDNS update
  MDNS.update();
}
