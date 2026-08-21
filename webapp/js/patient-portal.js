/**
 * PhysioPulse – Patient Portal Module
 * Handles: patient dashboard with doctor-set thresholds, rep counting,
 * exercise alerts, session history, and progress charts.
 */

const PatientPortal = (() => {
  let session    = null;
  let patient    = null;
  let threshold  = null;

  // ─── Rep Counting State ────────────────────────────────────────────────────
  let repCount   = 0;
  let wasAboveMin = false;    // tracks crossing of minAngle going up
  let sessionActive = false;
  let sessionStartTime = null;
  let sessionAngles = [];
  let sessionTemps  = [];
  let repTimestamps = [];
  let alertFired   = false;
  let sessionExerciseReps = 0;

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init(patientSession) {
    session   = patientSession;
    patient   = await Auth.getPatientByUserId(session.userId);
    if (patient) {
      threshold = await Auth.getThresholdForPatient(patient.id);
    }

    renderPatientDashboard();
    await renderPatientHistory();
    bindPatientEvents();
  }

  // ─── Patient Dashboard ─────────────────────────────────────────────────────
  async function renderPatientDashboard() {
    _setEl('ptPatientName', session.name);

    if (!patient) {
      _setEl('ptDoctorInfo', 'Not linked to a doctor');
      return;
    }

    // Doctor info
    const doctor = await Auth.getDoctorById(patient.doctorId);
    _setEl('ptDoctorInfo', doctor ? `Dr. ${doctor.name}` : 'Unknown Doctor');

    // Threshold display
    if (threshold) {
      _setEl('ptMinAngle',   threshold.minAngle   + '°');
      _setEl('ptMaxAngle',   threshold.maxAngle   + '°');
      _setEl('ptTargetReps', threshold.targetReps + ' reps');
      _setEl('ptExercise',   threshold.exerciseType || 'Exercise');
      _setEl('ptMotionLimit', threshold.motionLimit + ' °/s');
      _setEl('ptTempLimit',  threshold.tempLimit + ' °C');
      document.getElementById('ptThreshCard')?.classList.remove('hidden');
      document.getElementById('ptNoThresh')?.classList.add('hidden');
    } else {
      document.getElementById('ptThreshCard')?.classList.add('hidden');
      document.getElementById('ptNoThresh')?.classList.remove('hidden');
    }

    // History summary
    if (patient) {
      const history = await Auth.getExerciseHistoryForPatient(patient.id);
      _setEl('ptTotalSessions', history.length);
      const completed = history.filter(h => h.status === 'completed').length;
      _setEl('ptCompliance', history.length > 0 ? Math.round(completed / history.length * 100) + '%' : '—');
      const lastSession = history[0];
      _setEl('ptLastSession', lastSession ? new Date(lastSession.date).toLocaleDateString() : 'None yet');
    }
  }

  // ─── Rep Counter Logic ─────────────────────────────────────────────────────
  /**
   * Called on each sensor data frame during patient's active exercise session.
   * Tracks the pitch angle and counts reps as crossing events.
   * Also fires alerts if angle exceeds maxAngle or motion exceeds limit.
   */
  function processSensorForReps(data) {
    if (!sessionActive || !threshold) return;

    const pitch = data._pitch !== undefined ? data._pitch : 0;
    const absPitch = Math.abs(pitch);
    const gyroMag = Math.sqrt((data.gx||0)**2 + (data.gy||0)**2 + (data.gz||0)**2);
    const temp = data.tp || 0;

    // Track angles and temps for end-of-session stats
    sessionAngles.push(absPitch);
    sessionTemps.push(temp);

    // ── Rep Counting: count crossing of minAngle threshold ──
    // A "rep" = angle goes above minAngle (joint flexes) and returns below (extends)
    if (absPitch >= threshold.minAngle) {
      wasAboveMin = true;
    } else if (wasAboveMin && absPitch < threshold.minAngle) {
      // Completed a crossing: angle went up past min, now came back below
      repCount++;
      repTimestamps.push(Date.now());
      wasAboveMin = false;
      _setEl('ptRepCount', repCount);
      _setEl('ptRepCountBig', repCount);

      // Check if target reached
      if (repCount >= threshold.targetReps) {
        if (!alertFired) {
          alertFired = true;
          _showExerciseAlert('success', `🎉 Target reached! ${repCount} reps completed!`);
          App.showToast(`Great job! ${repCount} reps done!`, 'success');
        }
      }
    }

    // ── Overshoot Alert: angle exceeds maxAngle ──
    if (absPitch > threshold.maxAngle) {
      _showExerciseAlert('warning', `⚠ Angle too high! ${absPitch.toFixed(1)}° exceeds limit of ${threshold.maxAngle}°. Slow down!`);
    }

    // ── Motion Limit Alert ──
    if (gyroMag > (threshold.motionLimit || 100)) {
      _showExerciseAlert('warning', `⚠ Motion too fast! Slow down for safety.`);
    }

    // ── Temperature Alert ──
    if (temp > (threshold.tempLimit || 40)) {
      _showExerciseAlert('error', `🌡 High temperature detected: ${temp.toFixed(1)}°C. Take a rest!`);
    }

    // Update live exercise stats
    _setEl('ptLivePitch', absPitch.toFixed(1) + '°');
    _setEl('ptLiveGyro', gyroMag.toFixed(1) + ' °/s');
    _setEl('ptLiveTemp', temp.toFixed(1) + ' °C');

    // Update progress ring
    if (threshold.targetReps > 0) {
      const pct = Math.min(repCount / threshold.targetReps, 1);
      _updateRepRing(pct);
    }
  }

  function _updateRepRing(pct) {
    const ring = document.getElementById('repProgressRing');
    if (!ring) return;
    const circumference = 2 * Math.PI * 54; // r=54
    const offset = circumference - pct * circumference;
    ring.style.strokeDashoffset = offset;
    // Color: green if complete, cyan if progressing, gray if 0
    ring.style.stroke = pct >= 1 ? '#22c55e' : pct > 0 ? '#00d4ff' : 'rgba(255,255,255,0.15)';
  }

  function _showExerciseAlert(type, msg) {
    const alertEl = document.getElementById('ptExerciseAlert');
    const alertText = document.getElementById('ptExerciseAlertText');
    if (!alertEl || !alertText) return;
    alertEl.className = `exercise-alert ${type}`;
    alertText.textContent = msg;
    alertEl.classList.remove('hidden');

    // Auto-hide non-error alerts after 4 seconds
    if (type !== 'error' && type !== 'success') {
      clearTimeout(alertEl._timeout);
      alertEl._timeout = setTimeout(() => alertEl.classList.add('hidden'), 4000);
    }
  }

  // ─── Start/Stop Exercise Session ──────────────────────────────────────────
  function startExercise() {
    if (!threshold) {
      App.showToast('No thresholds set by your doctor yet. Please wait.', 'error');
      return;
    }
    sessionActive    = true;
    sessionStartTime = Date.now();
    repCount         = 0;
    wasAboveMin      = false;
    alertFired       = false;
    sessionAngles    = [];
    sessionTemps     = [];
    repTimestamps    = [];

    _setEl('ptRepCount', 0);
    _setEl('ptRepCountBig', 0);
    _updateRepRing(0);

    const startBtn = document.getElementById('ptStartExercise');
    const stopBtn  = document.getElementById('ptStopExercise');
    if (startBtn) startBtn.classList.add('hidden');
    if (stopBtn)  stopBtn.classList.remove('hidden');

    // Hide any stale alert
    document.getElementById('ptExerciseAlert')?.classList.add('hidden');

    App.showToast('Exercise session started! Begin your exercises.', 'success');

    // Timer
    const timerEl = document.getElementById('ptExerciseTimer');
    window._ptTimerInterval = setInterval(() => {
      const elapsed = Date.now() - sessionStartTime;
      const m = Math.floor(elapsed / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      if (timerEl) timerEl.textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    }, 500);
  }

  async function stopExercise() {
    if (!sessionActive) return;
    sessionActive = false;
    clearInterval(window._ptTimerInterval);

    const duration_s = Math.round((Date.now() - sessionStartTime) / 1000);
    const maxAngleReached = sessionAngles.length > 0 ? Math.max(...sessionAngles) : 0;
    const minAngleReached = sessionAngles.length > 0 ? Math.min(...sessionAngles) : 0;
    const avgTemp = sessionTemps.length > 0 ? sessionTemps.reduce((a, b) => a + b, 0) / sessionTemps.length : 0;

    // Determine compliance status
    let status;
    const pct = threshold ? repCount / threshold.targetReps : 0;
    if (pct >= 1)        status = 'completed';
    else if (pct >= 0.5) status = 'partial';
    else                 status = 'failed';

    const startBtn = document.getElementById('ptStartExercise');
    const stopBtn  = document.getElementById('ptStopExercise');
    if (startBtn) startBtn.classList.remove('hidden');
    if (stopBtn)  stopBtn.classList.add('hidden');

    // Show summary
    _showExerciseAlert(
      status === 'completed' ? 'success' : status === 'partial' ? 'warning' : 'error',
      status === 'completed'
        ? `✓ Session complete! ${repCount} reps in ${_formatDuration(duration_s)}`
        : `Session ended: ${repCount}/${threshold?.targetReps || '?'} reps (${status})`
    );

    // Save record
    if (patient) {
      try {
        await Auth.saveExerciseRecord({
          patientId: patient.id,
          doctorId: patient.doctorId,
          date: new Date().toISOString(),
          repsCompleted: repCount,
          targetReps: threshold?.targetReps || 0,
          maxAngleReached: parseFloat(maxAngleReached.toFixed(2)),
          minAngleReached: parseFloat(minAngleReached.toFixed(2)),
          avgTemp: parseFloat(avgTemp.toFixed(2)),
          duration_s,
          status,
          exerciseType: threshold?.exerciseType || 'Unknown',
        });
        App.showToast('Exercise session saved!', 'success');
        await renderPatientHistory();
      } catch (e) {
        console.error('[PatientPortal] Save error:', e);
        App.showToast('Error saving session', 'error');
      }
    }

    // Refresh dashboard
    await renderPatientDashboard();
  }

  // ─── Patient History ───────────────────────────────────────────────────────
  async function renderPatientHistory() {
    const histEl = document.getElementById('ptHistoryList');
    if (!histEl || !patient) return;

    const history = await Auth.getExerciseHistoryForPatient(patient.id);
    const emptyEl = document.getElementById('ptHistoryEmpty');

    if (history.length === 0) {
      histEl.innerHTML = '';
      emptyEl?.classList.remove('hidden');
      return;
    }
    emptyEl?.classList.add('hidden');

    histEl.innerHTML = history.map(h => `
      <div class="history-item">
        <div class="history-meta">
          <span class="history-patient">${h.exerciseType || 'Exercise'}</span>
          <span class="history-detail">${new Date(h.date).toLocaleString()} · Duration: ${h.duration_s ? _formatDuration(h.duration_s) : '—'}</span>
        </div>
        <div class="history-stats">
          <div class="h-stat">
            <span class="h-stat-label">Reps</span>
            <span class="h-stat-val">${h.repsCompleted || 0}/${h.targetReps || '?'}</span>
          </div>
          <div class="h-stat">
            <span class="h-stat-label">Max Angle</span>
            <span class="h-stat-val">${h.maxAngleReached != null ? h.maxAngleReached.toFixed(1) + '°' : '—'}</span>
          </div>
          <div class="h-stat">
            <span class="h-stat-label">Avg Temp</span>
            <span class="h-stat-val">${h.avgTemp != null ? h.avgTemp.toFixed(1) + ' °C' : '—'}</span>
          </div>
          <div class="h-stat">
            <span class="h-stat-label">Status</span>
            <span class="h-stat-val"><span class="status-badge ${h.status}">${h.status}</span></span>
          </div>
        </div>
      </div>
    `).join('');
  }

  // ─── Refresh Threshold ─────────────────────────────────────────────────────
  async function refreshThreshold() {
    if (!patient) return;
    threshold = await Auth.getThresholdForPatient(patient.id);
    renderPatientDashboard();
  }

  // ─── Bind Events ──────────────────────────────────────────────────────────
  function bindPatientEvents() {
    document.getElementById('ptStartExercise')?.addEventListener('click', startExercise);
    document.getElementById('ptStopExercise')?.addEventListener('click', stopExercise);
    document.getElementById('ptRefreshThreshold')?.addEventListener('click', () => {
      refreshThreshold().then(() => App.showToast('Thresholds refreshed from doctor', 'info'));
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function _setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  function _formatDuration(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  return {
    init,
    processSensorForReps,
    startExercise,
    stopExercise,
    renderPatientHistory,
    refreshThreshold,
    isSessionActive: () => sessionActive,
  };
})();
