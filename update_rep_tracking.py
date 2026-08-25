# 1. Update app.js processSensorData
with open("webapp/js/app.js", "r") as f:
    app_js = f.read()

import re

new_process_sensor = """  // ─── Sensor Data Processing ───────────────────────────────────────────────
  function processSensorData(raw) {
    const now = performance.now();
    const dt = lastDataTime ? (now - lastDataTime) / 1000 : 0.05;
    lastDataTime = now;

    const ax = parseFloat(raw.ax) || 0;
    const ay = parseFloat(raw.ay) || 0;
    const az = parseFloat(raw.az) || 0;
    const gx = parseFloat(raw.gx) || 0;
    const gy = parseFloat(raw.gy) || 0;
    const gz = parseFloat(raw.gz) || 0;
    const tp = parseFloat(raw.tp) || 0;

    let pitch = 0;
    if (raw.pitch !== undefined && raw.pitch !== null) {
      pitch = parseFloat(raw.pitch) || 0;
    } else if (raw.a !== undefined && raw.a !== null) {
      pitch = parseFloat(raw.a) || 0;
    } else if (ax !== 0 || ay !== 0 || az !== 0) {
      pitch = Math.atan2(ax, Math.sqrt(ay * ay + az * az)) * (180 / Math.PI);
    }

    const roll = raw.roll !== undefined ? raw.roll : (ax !== 0 || ay !== 0 || az !== 0 ? Math.atan2(ay, Math.sqrt(ax * ax + az * az)) * (180 / Math.PI) : 0);
    yaw += gz * dt;
    if (yaw > 180)  yaw -= 360;
    if (yaw < -180) yaw += 360;

    const hardwareReps = raw.reps !== undefined ? raw.reps : (raw.r !== undefined ? raw.r : (raw.raw?.r !== undefined ? raw.raw.r : null));
    const statusMsg = raw.message || raw.msg || raw.raw?.msg || '';

    latestSensorData = {
      pitch: Math.abs(pitch),
      roll,
      reps: hardwareReps,
      message: statusMsg,
      ax, ay, az, gx, gy, gz, tp,
      _pitch: Math.abs(pitch),
      _roll: roll,
      _yaw: yaw
    };

    const data = {
      ax, ay, az, gx, gy, gz, tp,
      pitch: Math.abs(pitch),
      roll,
      _pitch: Math.abs(pitch),
      _roll: roll,
      _yaw: yaw,
      reps: hardwareReps,
      message: statusMsg
    };

    updateSensorUI(data);
    Charts.push(data);
    Session.addDataPoint(data);

    // Patient rep counting
    if (userRole === 'patient') {
      PatientPortal.processSensorForReps(data);
    }

    frameCount++;
    lastUpdateTime = now;
    return data;
  }"""

app_js = re.sub(r'  // ─── Sensor Data Processing ───.*?  // ─── Sensor UI Updater ───', new_process_sensor + '\n\n  // ─── Sensor UI Updater ───', app_js, flags=re.DOTALL)

with open("webapp/js/app.js", "w") as f:
    f.write(app_js)

# 2. Update patient-portal.js processSensorForReps and startExercise
with open("webapp/js/patient-portal.js", "r") as f:
    pt_js = f.read()

new_process_reps = """  // ─── Rep Counting & Max Limit Enforcement ──────────────────────────────────
  function processSensorForReps(data) {
    if (!sessionActive || !threshold) return;

    const pitch = data.pitch !== undefined ? data.pitch : (data._pitch !== undefined ? data._pitch : (data.a || 0));
    const absPitch = Math.abs(pitch);
    const gyroMag = Math.sqrt((data.gx || 0) ** 2 + (data.gy || 0) ** 2 + (data.gz || 0) ** 2);
    const temp = data.tp || 0;

    sessionAngles.push(absPitch);
    sessionTemps.push(temp);

    const maxLimitAlert = document.getElementById('ptMaxLimitAlert');
    const maxLimitText = document.getElementById('ptMaxLimitText');

    // ── 1. Strict Max Angle Enforcement ──
    if (absPitch > threshold.maxAngle) {
      maxLimitExceeded = true;
      if (maxLimitAlert) {
        maxLimitAlert.classList.remove('hidden');
        if (maxLimitText) {
          maxLimitText.textContent = `⛔ DOCTOR LIMIT: Angle (${absPitch.toFixed(1)}°) exceeds maximum allowed (${threshold.maxAngle}°)! Stop movement.`;
        }
      }
    } else {
      maxLimitExceeded = false;
      if (maxLimitAlert && repCount < threshold.targetReps) {
        maxLimitAlert.classList.add('hidden');
      }
    }

    // ── 2. Rep Counting (Hardware Direct + Software Hybrid) ──
    if (data.reps !== null && data.reps !== undefined && data.reps > 0) {
      repCount = data.reps;
      _setEl('ptRepCount', repCount);
      _setEl('ptRepCountBig', repCount);
    } else {
      // Software crossing logic
      const minThreshold = Math.max(15, (threshold.minAngle || 30) - 10);
      const maxThreshold = Math.min(170, (threshold.maxAngle || 110) - 15);
      
      if (absPitch >= maxThreshold && !maxLimitExceeded) {
        wasAboveMin = true;
      } else if (wasAboveMin && absPitch <= minThreshold) {
        repCount++;
        repTimestamps.push(Date.now());
        wasAboveMin = false;
        _setEl('ptRepCount', repCount);
        _setEl('ptRepCountBig', repCount);
      }
    }

    if (repCount >= threshold.targetReps) {
      if (!alertFired) {
        alertFired = true;
        _showExerciseAlert('success', `🎉 Target reached! ${repCount}/${threshold.targetReps} reps completed. Doctor recommends finishing session.`);
        App.showToast(`🎉 Prescribed target of ${threshold.targetReps} reps completed!`, 'success');
        if (maxLimitAlert) {
          maxLimitAlert.classList.remove('hidden');
          if (maxLimitText) maxLimitText.textContent = `✓ Target Complete (${threshold.targetReps} reps). Please stop and save your session.`;
        }
      }
    }

    // ── 3. Motion Safety Alerts ──
    if (gyroMag > (threshold.motionLimit || 120)) {
      _showExerciseAlert('warning', `⚠ Motion too fast! Slow down for safety.`);
    }

    // Update live metrics
    _setEl('ptLivePitch', absPitch.toFixed(1) + '°');
    _setEl('ptLiveGyro', gyroMag.toFixed(1) + ' °/s');
    
    if (threshold.targetReps > 0) {
      const pct = Math.min(repCount / threshold.targetReps, 1);
      _updateRepRing(pct);
    }
  }"""

pt_js = re.sub(r'  // ─── Rep Counting & Max Limit Enforcement ───.*?  function _updateRepRing', new_process_reps + '\n\n  function _updateRepRing', pt_js, flags=re.DOTALL)

# Send command to BLE when starting exercise
new_start_ex = """    // Send BLE exercise selection command if connected
    if (typeof Connection !== 'undefined' && Connection.sendCommand && threshold?.exerciseType) {
      Connection.sendCommand('EX:' + threshold.exerciseType);
    }"""

pt_js = pt_js.replace("App.showToast('Exercise session started! Follow the demonstration.', 'success');", "App.showToast('Exercise session started! Follow the demonstration.', 'success');\n" + new_start_ex)

with open("webapp/js/patient-portal.js", "w") as f:
    f.write(pt_js)

print("Updated rep tracking and angle extraction in app.js and patient-portal.js!")
