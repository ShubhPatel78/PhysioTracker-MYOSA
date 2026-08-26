# PhysioPulse (MYOSA) 🫀
### Real-Time IoT Physiotherapy & Biomechanical Tele-Rehab System

---

## 🌟 Overview
**PhysioPulse (MYOSA)** is an end-to-end digital orthopedic rehabilitation system that pairs wearable **ESP32 IMU hardware** with a **dual-portal web platform** (Doctor Portal + Patient Portal) to automate rep counting, monitor Range of Motion (ROM), record doctor baselines, enforce safety thresholds, and track patient recovery.

---

## 🏗️ System Architecture

```
PhysioPulse-MYOSA/
├── backend/                        ← FastAPI + SQLAlchemy + SQLite Backend
│   ├── app/
│   │   ├── main.py                 ← FastAPI entry point & WebApp static mount
│   │   ├── models.py               ← Database Models (Users, Patients, Thresholds, Sessions, Pain Alerts)
│   │   ├── schemas.py              ← Pydantic Schemas & Validations
│   │   ├── auth.py                 ← JWT Auth & Password Hashing
│   │   ├── seed.py                 ← Database Seeder (Default Accounts)
│   │   └── routers/                ← REST API Endpoints (Auth, Patients, Thresholds, Sessions, Alerts)
│   ├── requirements.txt            ← Backend Python dependencies
│   └── run.py                      ← Local launcher (`python backend/run.py`)
├── firmware/
│   └── physiopulse_firmware/
│       └── physiopulse_firmware.ino ← Lightweight 50Hz BLE Raw IMU Streamer (Zero External Libs)
└── webapp/                         ← Progressive Web Application (PWA)
    ├── index.html                  ← Single-Page App with Doctor & Patient Portals
    ├── manifest.json & sw.js       ← PWA Service Worker for Mobile / Offline
    ├── css/style.css               ← Responsive Glassmorphic Dark Theme
    └── js/
        ├── physio-engine.js        ← V6.1 Biomechanical Math Engine & 6 Exercise FSMs
        ├── doctor-portal.js        ← Doctor Dashboard, 15s Baseline, Patient Creator & Credential Modal
        ├── patient-portal.js       ← Patient HUD, Live ROM Gauge & Rep Tracking
        ├── api.js                  ← REST API Client with Local Timezone (+5:30 IST) Support
        ├── auth.js                 ← Authentication State Manager
        ├── connection.js           ← Web Bluetooth (BLE) Manager
        ├── session.js              ← Session Recorder & CSV Exporter
        └── charts.js               ← Real-time Dynamic Biomechanical Visualizations
```

---

## 🚀 Getting Started (Local Run)

### 1. Backend & Web App
```bash
# 1. Open Terminal and navigate to repo
cd PhysioTracker-MYOSA

# 2. Activate Python Virtual Environment
source venv/bin/activate

# 3. Start the Server
python backend/run.py
```
- Web Application: **http://localhost:8000**
- API Documentation (Swagger): **http://localhost:8000/docs**
- Phone on Same Wi-Fi: **http://<YOUR_LOCAL_IP>:8000**

---

## 🔑 Default Login Credentials

| Role | Login Identifier | Password | Notes |
|---|---|---|---|
| **Doctor** | `doctor@physiopulse.com` | `doctor123` | Doctor PIN for 15s Baseline: `1234` |
| **Patient 1** | `PT-0004` | `shubh123` | Assigned to Doctor |
| **Patient 2** | `PT-0008` | `patient123` | Test Case Patient |

---

## 🩺 Hardware & Firmware Setup
1. Open `firmware/physiopulse_firmware/physiopulse_firmware.ino` in **Arduino IDE**.
2. Select **Board: ESP32 Dev Module**.
3. Upload to your ESP32 board over USB-C.
4. Open the Web App in **Google Chrome** and click **"Connect Bluetooth"** to pair directly with `PhysioPulse-Sensor`.

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

### 3. Start the Backend Server (with Patient History Database)

The backend provides persistent patient histories, exercise tracking, and doctor prescriptions.

1. Install Python dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```
2. Start the backend:
   ```bash
   python backend/run.py
   ```
   - **Web Application:** http://localhost:8000
   - **Interactive API Docs (Swagger):** http://localhost:8000/docs
   - **Preloaded Demo Accounts:**
     - **Doctor:** `doctor@physiopulse.com` / `doctor123` (Doctor Code: `DR0001`)
     - **Patient 1:** `john@example.com` / `patient123` (Preloaded with 3 exercise sessions)
     - **Patient 2:** `jane@example.com` / `patient123`

### 4. Connect to ESP32 via Bluetooth (BLE)

1. Open Chrome or Edge and go to **http://localhost:8000**
2. Log in as a Patient or Doctor.
3. Once logged in, go to the **Settings** page from the sidebar menu.
4. Under Connection, ensure **BLE** is selected.
5. Click **Connect to ESP32**. A browser popup will appear.
6. Select **PhysioPulse-XXXX** from the list and click Pair.
7. You are now connected and receiving real-time sensor data over Bluetooth!

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

## Backend REST API Endpoints (`http://localhost:8000`)

Interactive OpenAPI / Swagger UI is available at `http://localhost:8000/docs`.

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/auth/register` | POST | None | Register Doctor (generates Doctor Code) or Patient (linked by code) |
| `/api/auth/login` | POST | None | Log in and obtain JWT access token |
| `/api/auth/me` | GET | Bearer | Get current user details and linked profiles |
| `/api/patients` | GET | Bearer | List patients assigned to doctor |
| `/api/patients/{id}` | GET/PUT | Bearer | View / update patient baseline info & clinical condition |
| `/api/patients/{id}/threshold` | GET/POST | Bearer | Get or prescribe active range-of-motion & rep limits |
| `/api/patients/{id}/thresholds` | GET | Bearer | Audit trail of all threshold adjustments over time |
| `/api/exercise-history` | GET/POST | Bearer | Save and retrieve patient exercise completion & compliance |
| `/api/patients/{id}/exercise-history` | GET | Bearer | Get chronological exercise history for specific patient |
| `/api/patients/{id}/analytics` | GET | Bearer | ROM progression, compliance rate %, and session aggregates |
| `/api/sessions` | GET/POST | Optional | Store & list raw high-frequency sensor recordings (20 Hz) |
| `/api/sessions/{id}` | GET/DELETE | Optional | View full recorded session points / delete session |
| `/api/sessions/{id}/csv` | GET | None | Direct CSV export download of recorded sensor stream |

---

## ESP32 Device API Endpoints (Direct WiFi Mode)

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

## Backend Setup (Required for Multi-User Sync)

This app now uses a Supabase backend for:
- User authentication with **User ID + password** (no email login)
- Doctor-patient links
- Threshold history
- Exercise history
- Doctor-assigned YouTube exercise prescriptions
- Real-time sync between doctor and patient portals

### 1) Create Supabase project
- Create a new Supabase project.
- In SQL Editor, run:
  - `webapp/backend/supabase-schema.sql`

### 2) Configure frontend
- Open `/webapp/js/backend-config.js`
- Set:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`

### 3) Registration/Login behavior
- Users register with name + password (+ optional preferred User ID).
- If User ID is not provided, it is auto-generated (`DRxxxxxx` for doctors, `PTxxxxxx` for patients).
- Patients must provide their doctor’s User ID during registration.

---

## Hosting as Website + Mobile

- **Website:** deploy `/webapp` to GitHub Pages, Netlify, or Vercel.
- **Mobile:** this is a PWA (installable on mobile). You can additionally wrap it with Capacitor for Play Store/App Store release.
- Both web and mobile must use the same Supabase backend for synchronized data.

---

## GitHub Deployment Flow

1. Test locally (`python -m http.server 8000` from `/webapp`)
2. Push to GitHub
3. Set backend values securely in deployment environment
4. Run CI workflow
5. Publish website build
6. Optionally package and release mobile wrapper build

---

*Built for MYOSA 6.0 – Stage 2 Working Prototype by Team PhysioPulse*
