# PhysioPulse 🫀
### MYOSA 6.0 – Stage 2 Working Prototype
**Real-time Physiotherapy Monitoring System**

---

## Hardware

| Component | Part |
|---|---|
| MCU | MYOSA ESP32-WROVER Board (WiFi + BLE) |
| Sensor | MYOSA MPU-6050 / GY-521 Board |
| I2C Address | **0x69** (AD0 pin = HIGH) |
| I2C Pins | SDA = GPIO 21, SCL = GPIO 22 |
| Connectivity | USB-C for programming |

---

## Project Structure

```
MYOSA 6.0 PhysioPulse/
├── firmware/
│   ├── physiopulse_firmware.ino    ← Main ESP32 sketch (open this in Arduino IDE)
│   ├── mpu6050.h                   ← Custom MPU-6050 I2C driver
└── webapp/                         ← Web app source files (browser dev/testing)
    ├── index.html
    ├── manifest.json
    ├── sw.js
    ├── css/style.css
    └── js/
        ├── app.js
        ├── connection.js
        ├── charts.js
        └── session.js
```

---

## Step-by-Step Setup

### 1. Arduino IDE Setup

1. **Install Arduino IDE** from https://www.arduino.cc/en/software
2. **Add ESP32 Board Package:**
   - File → Preferences → Additional Boards Manager URLs:
     ```
     https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
     ```
   - Tools → Board → Boards Manager → search "esp32" → Install **"esp32" by Espressif Systems**

3. **Install Required Libraries** (Tools → Manage Libraries):
   - **WebSockets** by Markus Sattler (version 2.3.x or later)
   - **ArduinoJson** by Benoit Blanchon (version 6.x)

4. **Board Settings:**
   - Tools → Board → ESP32 Arduino → **"ESP32 Dev Module"**
   - Tools → Partition Scheme → **"No OTA (2MB APP/2MB SPIFFS)"** (or similar No OTA 2,2 option)
   - Tools → Flash Frequency → 80MHz
   - Tools → Upload Speed → **115200**
   - Tools → Port → **COM5**

### 2. Upload Firmware

1. Click the **Upload button** (→) in Arduino IDE
2. Wait for "Done uploading"
3. Open Serial Monitor (Tools → Serial Monitor) at **115200 baud**
4. You should see the startup banner:
   ```
   ╔══════════════════════════════════╗
   ║  PhysioPulse Firmware v1.0       ║
   ╚══════════════════════════════════╝
   [INIT] I2C device found at 0x69
   [INIT] MPU-6050 initialized ✓
   [WiFi] AP Started: SSID=PhysioPulse-XXXX, IP=192.168.4.1
   PhysioPulse is READY!
   ```

### 4. Run the Web App & Connect via Bluetooth (BLE)

Since you are running the web app locally, you will connect to the ESP32 using Web Bluetooth instead of WiFi.

1. Open your terminal and navigate to the `webapp` folder.
2. Start a local server: `python -m http.server 8000` (or use `npx serve`).
3. Open your Chrome or Edge browser (must support Web Bluetooth) and go to **http://localhost:8000**
4. Log in or Register in the app.
5. Once logged in, go to the **Settings** page from the sidebar menu.
6. Under Connection, ensure **BLE** is selected.
7. Click **Connect to ESP32**. A browser popup will appear.
8. Select **PhysioPulse-XXXX** from the list and click Pair.
9. You are now connected and receiving real-time sensor data over Bluetooth!

---

## Web App Features

| Page | Description |
|---|---|
| **Dashboard** | Live gauges for Accel, Gyro, Temperature, ROM angles |
| **Live Charts** | Full real-time rolling charts (20 Hz) |
| **Session** | Record, time & save patient sessions |
| **History** | View, replay, and download recorded sessions as CSV |
| **Settings** | WiFi/BLE toggle, calibrate gyro, adjust thresholds |
| **About** | Hardware info and connection guide |

---

## API Endpoints (when connected to ESP32)

| Endpoint | Method | Description |
|---|---|---|
| `http://192.168.4.1/` | GET | Serves the web app |
| `http://192.168.4.1/api/sensor` | GET | Latest sensor reading as JSON |
| `http://192.168.4.1/api/info` | GET | Device info (MAC, IP, uptime, heap) |
| `http://192.168.4.1/api/calibrate` | POST | Trigger gyro calibration |
| `ws://192.168.4.1:81` | WS | Real-time sensor stream (20 Hz) |

### WebSocket JSON Format
```json
{
  "t": 12345,      // timestamp (ms since boot)
  "ax": 0.0123,    // Accel X (g)
  "ay": -0.0045,   // Accel Y (g)
  "az": 0.9987,    // Accel Z (g)
  "gx": 1.2300,    // Gyro X (°/s, calibrated)
  "gy": -0.4500,   // Gyro Y (°/s, calibrated)
  "gz": 0.1200,    // Gyro Z (°/s, calibrated)
  "tp": 36.85,     // Temperature (°C)
  "cal": true      // Gyro calibrated?
}
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| MPU-6050 not found | Check I2C wiring (SDA=21, SCL=22). Verify sensor board is powered. |
| Upload fails | Hold BOOT button on ESP32 while uploading |
| WebSocket won't connect | Check you're connected to PhysioPulse WiFi hotspot |
| Sensor gives wrong values | Use Settings → Calibrate Gyroscope (keep sensor flat and still) |

---

## Technical Notes

- **Sample Rate:** 20 Hz (configurable in firmware via `SENSOR_INTERVAL_MS`)
- **I2C Address:** 0x69 (AD0 = HIGH on MYOSA MPU-6050 board)
- **Gyro Calibration:** Automatic on boot (500 samples); can retrigger via app
- **ROM Calculation:** Pitch and Roll from accelerometer via `atan2`; Yaw from gyro integration
- **BLE:** Primary connection mode when running web app locally (Requires Chrome, Edge, or supported browser).

---

*Built for MYOSA 6.0 – Stage 2 Working Prototype by Team PhysioPulse*
