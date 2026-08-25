/**
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║          PhysioTracker – 10-Exercise BLE Telemetry Firmware                ║
 * ║          MYOSA ESP32-WROVER + MPU-6050 (100% Standalone Single File)       ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 *
 * Requirements:
 *   - ESP32 Board Package installed in Arduino IDE
 *   - ZERO external third-party library installations required!
 *   - Completely self-contained in this single .ino file!
 *
 * Supported 10 Exercises:
 *   1. Bicep Curl
 *   2. Front Shoulder Raise
 *   3. Side Shoulder Raise
 *   4. Hand Circular Movement
 *   5. Wrist Circumduction
 *   6. Shoulder Overhead Press
 *   7. Elbow / Triceps Extension
 *   8. Knee Flexion / Extension
 *   9. Cervical / Neck Rotation
 *  10. Wrist Flexion / Extension
 *
 * BLE GATT Specification:
 *   Device Name:        PhysioTracker
 *   Service UUID:       4fafc201-1fb5-459e-8fcc-c5c9c331914b
 *   Telemetry UUID:     beb5483e-36e1-4688-b7f5-ea07361b26a1 (Notify, 10Hz)
 *     Format: {"r":12, "a":45.2, "tw":2.1, "st":4, "msg":"Curling Up..."}
 *   Command UUID:       beb5483e-36e1-4688-b7f5-ea07361b26a2 (Write)
 *     Commands: EX:<Name>, CAL1, CAL2, BASE:<pin>, TGT:<pin>:<reps>, END
 */

#include <Arduino.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>

// ─── Constants & Limits ────────────────────────────────────────────────────
#define DEVICE_BLE_NAME           "PhysioTracker"
#define DOCTOR_PIN                "1234"
#define COLLECT_SAMPLES           40
#define STABILITY_STD_LIMIT       0.05f
#define CROSSING_HYSTERESIS       5.0f 
#define MAX_SAMPLES               150
#define WRIST_CHEAT_ALIGNMENT     0.7f
#define BASELINE_MOTION_ONSET_DEG 10.0f
#define DEFAULT_CIRCULAR_REP_TGT  10.0f
#define SENSOR_INTERVAL_MS        20   // 50Hz sensor loop
#define TELEMETRY_INTERVAL_MS     100  // 10Hz BLE stream

// BLE UUIDs
#define BLE_SERVICE_UUID          "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define BLE_CHAR_TELEMETRY_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26a1"
#define BLE_CHAR_COMMAND_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26a2"

#define STATUS_LED  2

// ─── Embedded MPU-6050 Driver (No External Header Required) ────────────────
#define MPU6050_PWR_MGMT_1   0x6B
#define MPU6050_SMPLRT_DIV   0x19
#define MPU6050_CONFIG_REG   0x1A
#define MPU6050_GYRO_CONFIG  0x1B
#define MPU6050_ACCEL_CONFIG 0x1C
#define MPU6050_ACCEL_XOUT_H 0x3B
#define MPU6050_TEMP_OUT_H   0x41
#define MPU6050_GYRO_XOUT_H  0x43
#define MPU6050_WHO_AM_I     0x75

#define ACCEL_SCALE   16384.0f
#define GYRO_SCALE    131.0f

struct MPU6050Data {
  float accelX, accelY, accelZ;
  float gyroX,  gyroY,  gyroZ;
  float temperature;
  bool  valid;
};

class MPU6050 {
public:
  MPU6050(uint8_t addr = 0x69) : _addr(addr) {}

  bool begin() {
    Wire.begin();
    uint8_t whoAmI = readByte(MPU6050_WHO_AM_I);
    if (whoAmI != 0x68 && whoAmI != 0x69) {
      return false;
    }
    writeByte(MPU6050_PWR_MGMT_1, 0x00);
    delay(100);
    writeByte(MPU6050_PWR_MGMT_1, 0x01);
    writeByte(MPU6050_SMPLRT_DIV, 0x04);
    writeByte(MPU6050_CONFIG_REG, 0x03);
    writeByte(MPU6050_GYRO_CONFIG, 0x00);
    writeByte(MPU6050_ACCEL_CONFIG, 0x00);
    return true;
  }

  MPU6050Data read() {
    MPU6050Data data;
    data.valid = false;
    
    Wire.beginTransmission(_addr);
    Wire.write(MPU6050_ACCEL_XOUT_H);
    if (Wire.endTransmission(false) != 0) return data;
    
    uint8_t bytesRead = Wire.requestFrom(_addr, (uint8_t)14);
    if (bytesRead != 14) return data;
    
    int16_t rawAX = (Wire.read() << 8) | Wire.read();
    int16_t rawAY = (Wire.read() << 8) | Wire.read();
    int16_t rawAZ = (Wire.read() << 8) | Wire.read();
    int16_t rawT  = (Wire.read() << 8) | Wire.read();
    int16_t rawGX = (Wire.read() << 8) | Wire.read();
    int16_t rawGY = (Wire.read() << 8) | Wire.read();
    int16_t rawGZ = (Wire.read() << 8) | Wire.read();
    
    data.accelX = rawAX / ACCEL_SCALE;
    data.accelY = rawAY / ACCEL_SCALE;
    data.accelZ = rawAZ / ACCEL_SCALE;
    data.gyroX = rawGX / GYRO_SCALE;
    data.gyroY = rawGY / GYRO_SCALE;
    data.gyroZ = rawGZ / GYRO_SCALE;
    data.temperature = (rawT / 340.0f) + 36.53f;
    data.valid = true;
    return data;
  }

  void calibrateGyro(float &offsetX, float &offsetY, float &offsetZ) {
    const int SAMPLES = 400;
    double sumX = 0, sumY = 0, sumZ = 0;
    for (int i = 0; i < SAMPLES; i++) {
      MPU6050Data d = read();
      if (d.valid) {
        sumX += d.gyroX;
        sumY += d.gyroY;
        sumZ += d.gyroZ;
      }
      delay(2);
    }
    offsetX = sumX / SAMPLES;
    offsetY = sumY / SAMPLES;
    offsetZ = sumZ / SAMPLES;
  }

private:
  uint8_t _addr;
  void writeByte(uint8_t reg, uint8_t val) {
    Wire.beginTransmission(_addr);
    Wire.write(reg);
    Wire.write(val);
    Wire.endTransmission();
  }
  uint8_t readByte(uint8_t reg) {
    Wire.beginTransmission(_addr);
    Wire.write(reg);
    Wire.endTransmission(false);
    Wire.requestFrom(_addr, (uint8_t)1);
    return Wire.read();
  }
};

// ─── 3D Vector Math Helpers ────────────────────────────────────────────────
struct Vec3 { float x, y, z; };

Vec3 normalize(Vec3 vec) {
  float mag = sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z);
  if (mag < 1e-6f) return {0, 0, 0};
  return {vec.x / mag, vec.y / mag, vec.z / mag};
}
Vec3 crossProduct(Vec3 a, Vec3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
float dotProduct(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec3 vecAdd(Vec3 a, Vec3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
Vec3 vecScale(Vec3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }

// ─── State Machine & Globals ───────────────────────────────────────────────
Preferences prefs;
MPU6050 mpu(0x69);

BLEServer *pBLEServer = nullptr;
BLECharacteristic *pCharTelemetry = nullptr;
BLECharacteristic *pCharCommand = nullptr;
bool bleDeviceConnected = false;

// Gravity & Fusion
Vec3 filteredGravity = {0, 0, -1};
unsigned long lastFusionMicros = 0;
bool fusionInitialized = false;
Vec3 u = {0, 0, 0}, v = {0, 0, 0}, n = {0, 0, 0}, e1 = {0, 0, 0}, e2 = {0, 0, 0};
Vec3 lastGyro = {0, 0, 0};

// Telemetry State
String currentExercise = "Bicep Curl";
String maxKey = "bc_max";
String swayKey = "bc_sway";
int reps = 0;
float liveAngle = 0.0f;
float twistError = 0.0f;
bool isRaised = false;
String formStatus = "Ready";
float rawAngleForUnwrap = 0.0f;
int calibState = 0;
bool sessionComplete = false;

// Circular Exercise State
int lastLoopCount = 0;
float circleLiveAngle = 0.0f;
float circleRawForUnwrap = 0.0f;
bool targetIsDoctorConfirmed = false;

// Targets
float targetMaxAngle = 75.0f;
float maxDeviationPlane = 20.0f;

// Calibration & Baseline Buffers
bool collecting = false;
int collectStage = 0;
int collectCount = 0;
unsigned long lastCollectMillis = 0;
Vec3 collectSum = {0, 0, 0}, collectSumSq = {0, 0, 0};

float angleBuffer[MAX_SAMPLES];
float swayBuffer[MAX_SAMPLES];
int sampleIndex = 0;
unsigned long lastSampleMillis = 0;
unsigned long baselineStartTime = 0;
bool baseline_started = false;
bool angleResetPending = false;
unsigned long lastTelemetryMillis = 0;

// ─── Function Prototypes ───────────────────────────────────────────────────
void processBicepCurl();
void processFrontRaise();
void processSideRaise();
void processHandCircle();
void processWristCircle();
void processShoulderPress();
void processElbowExtension();
void processKneeFlexion();
void processNeckRotation();
void processWristFlexion();
void processCommand(const String& cmd);

// ─── Gravity Estimator ─────────────────────────────────────────────────────
Vec3 updateGravityEstimate(Vec3 gyro, Vec3 accel, float dt) {
  if (!fusionInitialized) {
    filteredGravity = normalize(accel);
    fusionInitialized = true;
    return filteredGravity;
  }
  Vec3 predicted = vecAdd(filteredGravity, vecScale(crossProduct(filteredGravity, gyro), dt));
  predicted = normalize(predicted);
  float accelMag = sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z);
  float magError = fabs(accelMag - 9.80665f) / 9.80665f;
  float accelTrust = 0.02f * constrain(1.0f - magError * 3.0f, 0.0f, 1.0f);
  Vec3 accelDir = normalize(accel);
  Vec3 fused = vecAdd(vecScale(predicted, 1.0f - accelTrust), vecScale(accelDir, accelTrust));
  filteredGravity = normalize(fused);
  return filteredGravity;
}

float angleDiff(float a, float b) {
  float d = fmod(b - a + 180.0f, 360.0f);
  if (d < 0) d += 360.0f;
  return d - 180.0f;
}

void sortArray(float *arr, int len) {
  for (int i = 1; i < len; i++) {
    float key = arr[i];
    int j = i - 1;
    while (j >= 0 && arr[j] > key) {
      arr[j + 1] = arr[j];
      j = j - 1;
    }
    arr[j + 1] = key;
  }
}

// ─── Calibration Step 1 & 2 ────────────────────────────────────────────────
void beginCollection(int stage) {
  collecting = true;
  collectStage = stage;
  collectCount = 0;
  collectSum = {0, 0, 0};
  collectSumSq = {0, 0, 0};
  lastCollectMillis = millis();
  formStatus = (stage == 1) ? "Hold still: capturing rest..." : "Hold still: capturing direction...";
}

bool serviceCollection() {
  if (!collecting) return false;
  if (millis() - lastCollectMillis < 10) return false;
  lastCollectMillis = millis();

  Vec3 g = filteredGravity;
  collectSum = vecAdd(collectSum, g);
  collectSumSq = vecAdd(collectSumSq, {g.x * g.x, g.y * g.y, g.z * g.z});
  collectCount++;

  if (collectCount >= COLLECT_SAMPLES) {
    collecting = false;
    Vec3 mean = vecScale(collectSum, 1.0f / collectCount);
    Vec3 meanSq = vecScale(collectSumSq, 1.0f / collectCount);
    float varX = meanSq.x - mean.x * mean.x;
    float varY = meanSq.y - mean.y * mean.y;
    float varZ = meanSq.z - mean.z * mean.z;
    float stdTotal = sqrt(max(varX, 0.0f) + max(varY, 0.0f) + max(varZ, 0.0f));

    if (stdTotal > STABILITY_STD_LIMIT) {
      formStatus = (collectStage == 1) ? "Not still enough -- retry Step 1" : "Not still enough -- retry Step 2";
      return true;
    }

    Vec3 result = normalize(mean);
    if (collectStage == 1) {
      u = result;
      calibState = 1;
      formStatus = "Step 1 OK. Move arm UP slightly for Step 2";
    } else {
      v = result;
      Vec3 crossRaw = crossProduct(u, v);
      if (sqrt(crossRaw.x * crossRaw.x + crossRaw.y * crossRaw.y + crossRaw.z * crossRaw.z) < 0.15f) {
        calibState = 1;
        formStatus = "Move arm a bit more, then retry Step 2";
        return true;
      }
      n = normalize(crossRaw);
      e1 = u;
      e2 = normalize(crossProduct(n, u));

      rawAngleForUnwrap = 0.0f;
      liveAngle = 0.0f;
      circleRawForUnwrap = 0.0f;
      circleLiveAngle = 0.0f;
      reps = 0;
      isRaised = false;

      bool isCircular = (currentExercise == "Hand Circular Movement" || currentExercise == "Wrist Circumduction");

      if (prefs.isKey(maxKey.c_str()) && prefs.isKey(swayKey.c_str())) {
        targetMaxAngle = prefs.getFloat(maxKey.c_str());
        maxDeviationPlane = prefs.getFloat(swayKey.c_str());
        targetIsDoctorConfirmed = true;
        calibState = 4;
        formStatus = "Profile Loaded. Ready!";
      } else if (isCircular) {
        targetMaxAngle = DEFAULT_CIRCULAR_REP_TGT;
        maxDeviationPlane = 0.0f;
        targetIsDoctorConfirmed = false;
        calibState = 4;
        formStatus = "Default Target. Ready!";
      } else {
        calibState = 4;
        formStatus = "Calibrated. Ready!";
      }
    }
    return true;
  }
  return false;
}

// ─── 10 Exercise Processing Engines ────────────────────────────────────────

// 1. Bicep Curl
void processBicepCurl() {
  float safeTarget = min(targetMaxAngle, 175.0f);
  float THRESHOLD_UP = safeTarget - 15.0f;
  float THRESHOLD_DOWN = 20.0f;
  if (THRESHOLD_DOWN >= THRESHOLD_UP) THRESHOLD_DOWN = THRESHOLD_UP - 10.0f;
  float HYPEREXTEND_LIMIT = min(-15.0f, THRESHOLD_DOWN - 20.0f);
  float MAX_SWAY = maxDeviationPlane + 5.0f;

  if (fabs(twistError) > MAX_SWAY) formStatus = "Bad Form: Keep Movement Aligned!";
  else if (liveAngle < HYPEREXTEND_LIMIT) formStatus = "Bad Form: Arm Dropped";
  else {
    if (liveAngle > THRESHOLD_UP && !isRaised) { isRaised = true; formStatus = "Hold Peak Curl..."; }
    else if (liveAngle < THRESHOLD_DOWN && isRaised) { isRaised = false; reps++; formStatus = "Rep Complete! Ready"; }
    else if (liveAngle > THRESHOLD_DOWN && liveAngle < THRESHOLD_UP) formStatus = isRaised ? "Lowering..." : "Curling Up...";
  }
}

// 2. Front Shoulder Raise
void processFrontRaise() {
  float safeTarget = min(targetMaxAngle, 175.0f);
  float THRESHOLD_UP = safeTarget - 15.0f;
  float THRESHOLD_DOWN = 20.0f;
  if (THRESHOLD_DOWN >= THRESHOLD_UP) THRESHOLD_DOWN = THRESHOLD_UP - 10.0f;
  float MAX_SWAY = maxDeviationPlane + 5.0f;

  if (fabs(twistError) > MAX_SWAY) formStatus = "Bad Form: Stop Swaying Outward!";
  else {
    if (liveAngle > THRESHOLD_UP && !isRaised) { isRaised = true; formStatus = "Hold Height..."; }
    else if (liveAngle < THRESHOLD_DOWN && isRaised) { isRaised = false; reps++; formStatus = "Rep Complete! Ready"; }
    else if (liveAngle > THRESHOLD_DOWN && liveAngle < THRESHOLD_UP) formStatus = isRaised ? "Lowering Control..." : "Raising Forward...";
  }
}

// 3. Side Shoulder Raise
void processSideRaise() {
  float safeTarget = min(targetMaxAngle, 175.0f);
  float THRESHOLD_UP = safeTarget - 15.0f;
  float THRESHOLD_DOWN = 20.0f;
  if (THRESHOLD_DOWN >= THRESHOLD_UP) THRESHOLD_DOWN = THRESHOLD_UP - 10.0f;
  float MAX_SWAY = maxDeviationPlane + 3.0f;

  if (fabs(twistError) > MAX_SWAY) formStatus = "Bad Form: Keep Arm Strictly Sideways!";
  else {
    if (liveAngle > THRESHOLD_UP && !isRaised) { isRaised = true; formStatus = "Hold Height..."; }
    else if (liveAngle < THRESHOLD_DOWN && isRaised) { isRaised = false; reps++; formStatus = "Rep Complete! Ready"; }
    else if (liveAngle > THRESHOLD_DOWN && liveAngle < THRESHOLD_UP) formStatus = isRaised ? "Lowering Control..." : "Raising Sideways...";
  }
}

// 4. Hand Circular Movement
void processHandCircle() {
  if (sessionComplete) return;
  int currentLoopCount = (int)(fabs(circleLiveAngle) / 360.0f);
  if (currentLoopCount > lastLoopCount) {
    reps += (currentLoopCount - lastLoopCount);
    lastLoopCount = currentLoopCount;
    formStatus = "Loop Complete! Keep Circling...";
  } else {
    formStatus = "Circling...";
  }
  if (targetMaxAngle > 0 && reps >= (int)targetMaxAngle) {
    formStatus = "Target Reps Reached!";
    sessionComplete = true;
  }
}

// 5. Wrist Circumduction
void processWristCircle() {
  if (sessionComplete) return;
  int currentLoopCount = (int)(fabs(circleLiveAngle) / 360.0f);
  if (currentLoopCount > lastLoopCount) {
    reps += (currentLoopCount - lastLoopCount);
    lastLoopCount = currentLoopCount;
    formStatus = "Loop Complete! Keep Circling...";
  } else {
    formStatus = "Circling...";
  }
  float gyroMag = sqrt(lastGyro.x * lastGyro.x + lastGyro.y * lastGyro.y + lastGyro.z * lastGyro.z);
  if (gyroMag > 0.3f) {
    float axisAlignment = fabs(dotProduct(normalize(lastGyro), u));
    if (axisAlignment > WRIST_CHEAT_ALIGNMENT) formStatus = "Bad Form: Rotate Hand Only!";
  }
  if (targetMaxAngle > 0 && reps >= (int)targetMaxAngle) {
    formStatus = "Target Reps Reached!";
    sessionComplete = true;
  }
}

// 6. Shoulder Overhead Press
void processShoulderPress() {
  float safeTarget = min(targetMaxAngle, 175.0f);
  float THRESHOLD_UP = safeTarget - 15.0f;
  float THRESHOLD_DOWN = 25.0f;
  if (THRESHOLD_DOWN >= THRESHOLD_UP) THRESHOLD_DOWN = THRESHOLD_UP - 10.0f;

  if (liveAngle > THRESHOLD_UP && !isRaised) { isRaised = true; formStatus = "Lockout at Top!"; }
  else if (liveAngle < THRESHOLD_DOWN && isRaised) { isRaised = false; reps++; formStatus = "Good Press! Ready"; }
  else if (liveAngle > THRESHOLD_DOWN && liveAngle < THRESHOLD_UP) formStatus = isRaised ? "Lowering to Shoulders..." : "Pressing Overhead...";
}

// 7. Elbow / Triceps Extension
void processElbowExtension() {
  float safeTarget = min(targetMaxAngle, 170.0f);
  float THRESHOLD_UP = safeTarget - 15.0f;
  float THRESHOLD_DOWN = 20.0f;

  if (liveAngle > THRESHOLD_UP && !isRaised) { isRaised = true; formStatus = "Full Extension! Hold"; }
  else if (liveAngle < THRESHOLD_DOWN && isRaised) { isRaised = false; reps++; formStatus = "Rep Complete! Ready"; }
  else if (liveAngle > THRESHOLD_DOWN && liveAngle < THRESHOLD_UP) formStatus = isRaised ? "Bending Arm..." : "Extending Elbow...";
}

// 8. Knee Flexion / Extension
void processKneeFlexion() {
  float safeTarget = min(targetMaxAngle, 140.0f);
  float THRESHOLD_UP = safeTarget - 15.0f;
  float THRESHOLD_DOWN = 20.0f;

  if (liveAngle > THRESHOLD_UP && !isRaised) { isRaised = true; formStatus = "Peak Flexion!"; }
  else if (liveAngle < THRESHOLD_DOWN && isRaised) { isRaised = false; reps++; formStatus = "Full Extension! Ready"; }
  else if (liveAngle > THRESHOLD_DOWN && liveAngle < THRESHOLD_UP) formStatus = isRaised ? "Straightening Leg..." : "Bending Knee...";
}

// 9. Cervical / Neck Rotation
void processNeckRotation() {
  float safeTarget = min(targetMaxAngle, 85.0f);
  float THRESHOLD_UP = safeTarget - 10.0f;
  float THRESHOLD_DOWN = 10.0f;

  if (fabs(liveAngle) > THRESHOLD_UP && !isRaised) { isRaised = true; formStatus = "Hold Neck Stretch..."; }
  else if (fabs(liveAngle) < THRESHOLD_DOWN && isRaised) { isRaised = false; reps++; formStatus = "Center Position. Ready"; }
  else if (fabs(liveAngle) > THRESHOLD_DOWN && fabs(liveAngle) < THRESHOLD_UP) formStatus = isRaised ? "Returning to Center..." : "Rotating Neck...";
}

// 10. Wrist Flexion / Extension
void processWristFlexion() {
  float safeTarget = min(targetMaxAngle, 75.0f);
  float THRESHOLD_UP = safeTarget - 10.0f;
  float THRESHOLD_DOWN = 10.0f;

  if (fabs(liveAngle) > THRESHOLD_UP && !isRaised) { isRaised = true; formStatus = "Hold Wrist Flexion..."; }
  else if (fabs(liveAngle) < THRESHOLD_DOWN && isRaised) { isRaised = false; reps++; formStatus = "Rep Complete! Ready"; }
  else if (fabs(liveAngle) > THRESHOLD_DOWN && fabs(liveAngle) < THRESHOLD_UP) formStatus = isRaised ? "Releasing Flexion..." : "Flexing Wrist...";
}

// ─── Route to Active Exercise ──────────────────────────────────────────────
void routeActiveExercise() {
  if (currentExercise == "Bicep Curl") processBicepCurl();
  else if (currentExercise == "Front Shoulder Raise" || currentExercise == "Front Raise") processFrontRaise();
  else if (currentExercise == "Side Shoulder Raise" || currentExercise == "Side Raise") processSideRaise();
  else if (currentExercise == "Hand Circular Movement" || currentExercise == "Hand Circle") processHandCircle();
  else if (currentExercise == "Wrist Circumduction" || currentExercise == "Wrist Circle") processWristCircle();
  else if (currentExercise == "Shoulder Overhead Press" || currentExercise == "Shoulder Press") processShoulderPress();
  else if (currentExercise == "Elbow / Triceps Extension" || currentExercise == "Triceps Extension") processElbowExtension();
  else if (currentExercise == "Knee Flexion / Extension" || currentExercise == "Knee Flexion") processKneeFlexion();
  else if (currentExercise == "Cervical / Neck Rotation" || currentExercise == "Neck Rotation") processNeckRotation();
  else if (currentExercise == "Wrist Flexion / Extension" || currentExercise == "Wrist Flexion") processWristFlexion();
  else processBicepCurl();
}

// ─── BLE & Command Handlers ────────────────────────────────────────────────
void processCommand(const String& cmd) {
  if (cmd.startsWith("EX:")) {
    currentExercise = cmd.substring(3);
    reps = 0;
    isRaised = false;
    sessionComplete = false;
    formStatus = "Selected: " + currentExercise;
    if (calibState >= 2) calibState = 4;
    Serial.printf("[BLE CMD] Set exercise: %s\n", currentExercise.c_str());
  }
  else if (cmd == "CAL1") {
    beginCollection(1);
    Serial.println("[BLE CMD] Triggered Step 1 (Resting)");
  }
  else if (cmd == "CAL2") {
    beginCollection(2);
    Serial.println("[BLE CMD] Triggered Step 2 (Direction)");
  }
  else if (cmd.startsWith("BASE:")) {
    String pin = cmd.substring(5);
    if (pin == DOCTOR_PIN) {
      calibState = 3;
      sampleIndex = 0;
      baseline_started = false;
      baselineStartTime = millis();
      angleResetPending = true;
      formStatus = "Doctor Baseline: Waiting for motion...";
      Serial.println("[BLE CMD] Doctor Baseline Triggered");
    } else {
      formStatus = "Error: Invalid Doctor PIN";
    }
  }
  else if (cmd.startsWith("TGT:")) {
    int firstColon = cmd.indexOf(':');
    int secondColon = cmd.indexOf(':', firstColon + 1);
    if (secondColon > 0) {
      String pin = cmd.substring(firstColon + 1, secondColon);
      int targetVal = cmd.substring(secondColon + 1).toInt();
      if (pin == DOCTOR_PIN && targetVal > 0) {
        targetMaxAngle = (float)targetVal;
        targetIsDoctorConfirmed = true;
        prefs.putFloat(maxKey.c_str(), targetMaxAngle);
        formStatus = "Target Set: " + String(targetVal) + " reps/deg";
        Serial.printf("[BLE CMD] Target set to %d\n", targetVal);
      }
    }
  }
  else if (cmd == "END") {
    sessionComplete = true;
    formStatus = "Session Complete! Reps: " + String(reps);
    Serial.printf("[BLE CMD] Session Ended. Total Reps: %d\n", reps);
  }
  else if (cmd == "calibrate") {
    float ox, oy, oz;
    mpu.calibrateGyro(ox, oy, oz);
    formStatus = "Gyro Calibrated";
  }
}

// ─── Global Last Sensor Reading Cache ─────────────────────────────────────
MPU6050Data gLastSensor;

// ─── Build Telemetry JSON ──────────────────────────────────────────────────
String buildTelemetryJSON() {
  bool isCircular = (currentExercise == "Hand Circular Movement" || currentExercise == "Wrist Circumduction");
  float displayAngle = isCircular ? fmod(fabs(circleLiveAngle), 360.0f) : fabs(liveAngle);

  // Fallback: if calibState < 2, calculate direct accelerometer tilt angle
  if (calibState < 2) {
    float directPitch = atan2(gLastSensor.accelX, sqrt(gLastSensor.accelY * gLastSensor.accelY + gLastSensor.accelZ * gLastSensor.accelZ)) * 180.0f / PI;
    displayAngle = fabs(directPitch);
  }

  char buf[256];
  snprintf(buf, sizeof(buf), "{\"r\":%d,\"a\":%.1f,\"tw\":%.1f,\"st\":%d,\"msg\":\"%s\",\"ax\":%.3f,\"ay\":%.3f,\"az\":%.3f,\"gx\":%.1f,\"gy\":%.1f,\"gz\":%.1f,\"tp\":%.1f}",
           reps, displayAngle, fabs(twistError), calibState, formStatus.c_str(),
           gLastSensor.accelX, gLastSensor.accelY, gLastSensor.accelZ,
           gLastSensor.gyroX, gLastSensor.gyroY, gLastSensor.gyroZ,
           gLastSensor.temperature);
  return String(buf);
}

// ─── BLE Callbacks ─────────────────────────────────────────────────────────
class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    String rxValue = pCharacteristic->getValue().c_str();
    rxValue.trim();
    if (rxValue.length() > 0) {
      Serial.printf("[BLE RX] %s\n", rxValue.c_str());
      processCommand(rxValue);
    }
  }
};

class MyBLEServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    bleDeviceConnected = true;
    Serial.println("[BLE] App connected to PhysioTracker");
    digitalWrite(STATUS_LED, HIGH);
  }
  void onDisconnect(BLEServer* pServer) {
    bleDeviceConnected = false;
    Serial.println("[BLE] App disconnected, restarting advertising...");
    pServer->startAdvertising();
    digitalWrite(STATUS_LED, LOW);
  }
};

void setupBLE() {
  BLEDevice::init(DEVICE_BLE_NAME);
  pBLEServer = BLEDevice::createServer();
  pBLEServer->setCallbacks(new MyBLEServerCallbacks());

  BLEService *pService = pBLEServer->createService(BLE_SERVICE_UUID);

  // Telemetry Characteristic (Notify)
  pCharTelemetry = pService->createCharacteristic(
    BLE_CHAR_TELEMETRY_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharTelemetry->addDescriptor(new BLE2902());

  // Command Characteristic (Write)
  pCharCommand = pService->createCharacteristic(
    BLE_CHAR_COMMAND_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  pCharCommand->setCallbacks(new CommandCallbacks());

  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

  Serial.printf("[BLE] Advertising as '%s'\n", DEVICE_BLE_NAME);
}

// ─── Arduino Setup ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n╔═══════════════════════════════════════════════════╗");
  Serial.println("║  PhysioTracker 10-Exercise BLE Telemetry Firmware ║");
  Serial.println("║  100% Standalone Single File – Standard ESP32     ║");
  Serial.println("╚═══════════════════════════════════════════════════╝");

  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);
  prefs.begin("physiopulse", false);

  // Initialize MPU-6050 on I2C
  if (!mpu.begin()) {
    MPU6050 mpuAlt(0x68);
    if (mpuAlt.begin()) mpu = mpuAlt;
  }

  // Initialize BLE GATT Server
  setupBLE();

  digitalWrite(STATUS_LED, HIGH);
  lastFusionMicros = micros();
  Serial.println("[READY] PhysioTracker is broadcasting on BLE!");
}

// ─── Arduino Main Loop ─────────────────────────────────────────────────────
void loop() {
  // 1. Read MPU-6050 Sensor & run 3D Vector Gravity Fusion
  MPU6050Data sensorData = mpu.read();
  if (sensorData.valid) {
    gLastSensor = sensorData;
    unsigned long nowMicros = micros();
    float dt = (nowMicros - lastFusionMicros) / 1e6f;
    if (dt <= 0 || dt > 0.5f) dt = 0.01f;
    lastFusionMicros = nowMicros;

    Vec3 accel = {sensorData.accelX * 9.80665f, sensorData.accelY * 9.80665f, sensorData.accelZ * 9.80665f};
    Vec3 gyro = {sensorData.gyroX * (PI / 180.0f), sensorData.gyroY * (PI / 180.0f), sensorData.gyroZ * (PI / 180.0f)};
    lastGyro = {sensorData.gyroX, sensorData.gyroY, sensorData.gyroZ};
    
    Vec3 fused = updateGravityEstimate(gyro, accel, dt);
    serviceCollection();

    if (calibState >= 2) {
      float n_dot = constrain(dotProduct(fused, n), -1.0f, 1.0f);
      twistError = asin(n_dot) * 180.0f / PI;

      float x = dotProduct(fused, e1);
      float y = dotProduct(fused, e2);
      float rawAngle = atan2(y, x) * 180.0f / PI;

      if (angleResetPending) {
        liveAngle = 0.0f;
        rawAngleForUnwrap = rawAngle;
        angleResetPending = false;
      } else {
        liveAngle += angleDiff(rawAngleForUnwrap, rawAngle);
        rawAngleForUnwrap = rawAngle;
      }

      if (liveAngle > 360.0f) liveAngle -= 360.0f;
      else if (liveAngle < -360.0f) liveAngle += 360.0f;

      float cx = dotProduct(fused, n);
      float cy = dotProduct(fused, e2);
      float cRaw = atan2(cy, cx) * 180.0f / PI;
      circleLiveAngle += angleDiff(circleRawForUnwrap, cRaw);
      circleRawForUnwrap = cRaw;

      // Phase 2: Doctor Baseline Capture
      if (calibState == 3) {
        if (!baseline_started) {
          if (millis() - baselineStartTime > 5000) {
            calibState = 2;
            formStatus = "Error: Timeout";
          } else {
            float angularDeviation = acos(constrain(dotProduct(fused, u), -1.0f, 1.0f)) * 180.0f / PI;
            if (angularDeviation > BASELINE_MOTION_ONSET_DEG) {
              baseline_started = true;
              lastSampleMillis = millis();
              formStatus = "Recording Baseline (15s)...";
            }
          }
        } else if (millis() - lastSampleMillis >= 100) {
          lastSampleMillis = millis();
          if (sampleIndex < MAX_SAMPLES) {
            angleBuffer[sampleIndex] = liveAngle;
            swayBuffer[sampleIndex] = fabs(twistError);
            sampleIndex++;
          }
          if (sampleIndex >= MAX_SAMPLES) {
            sortArray(angleBuffer, MAX_SAMPLES);
            sortArray(swayBuffer, MAX_SAMPLES);
            int p90_idx = (int)(MAX_SAMPLES * 0.90);
            targetMaxAngle = angleBuffer[p90_idx];
            maxDeviationPlane = max(10.0f, swayBuffer[p90_idx]);
            targetIsDoctorConfirmed = true;
            prefs.putFloat(maxKey.c_str(), targetMaxAngle);
            prefs.putFloat(swayKey.c_str(), maxDeviationPlane);
            calibState = 4;
            formStatus = "Baseline Saved. Ready!";
          }
        }
      }
      // Phase 3: Active Rep State Machine
      else if (calibState == 4) {
        routeActiveExercise();
      }
    }
  }

  // 2. Broadcast BLE Telemetry 10 times a second (every 100ms)
  unsigned long now = millis();
  if (now - lastTelemetryMillis >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMillis = now;
    if (bleDeviceConnected && pCharTelemetry != nullptr) {
      String telemetryPacket = buildTelemetryJSON();
      pCharTelemetry->setValue(telemetryPacket.c_str());
      pCharTelemetry->notify();
    }
  }
}
