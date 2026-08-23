/**
 * PhysioPulse – Patient Portal Module
 * Handles dashboard, thresholds, rep counting, history, and synced doctor prescriptions.
 */

const PatientPortal = (() => {
  let session = null;
  let patient = null;
  let threshold = null;
  let prescriptions = [];
  let unsubscribeRealtime = null;

  let repCount = 0;
  let wasAboveMin = false;
  let sessionActive = false;
  let sessionStartTime = null;
  let sessionAngles = [];
  let sessionTemps = [];
  let repTimestamps = [];
  let alertFired = false;

  async function init(patientSession) {
    session = patientSession;
    patient = await Auth.getPatientByUserId(session.userId);
    if (patient) {
      threshold = await Auth.getThresholdForPatient(patient.id);
      prescriptions = await Auth.getExercisePrescriptionsForPatient(patient.id);
      if (unsubscribeRealtime) unsubscribeRealtime();
      unsubscribeRealtime = Auth.subscribeToPatientUpdates(patient.id, async () => {
        await refreshThreshold(true);
      });
    }

    renderPatientDashboard();
    await renderPatientHistory();
    renderPrescriptions();
    bindPatientEvents();
  }

  async function renderPatientDashboard() {
    _setEl('ptPatientName', session.name);

    if (!patient) {
      _setEl('ptDoctorInfo', 'Not linked to a doctor');
      return;
    }

    const doctor = await Auth.getDoctorById(patient.doctorId);
    _setEl('ptDoctorInfo', doctor ? `Dr. ${doctor.name} (${doctor.userId})` : 'Unknown Doctor');

    if (threshold) {
      _setEl('ptMinAngle', threshold.minAngle + '°');
      _setEl('ptMaxAngle', threshold.maxAngle + '°');
      _setEl('ptTargetReps', threshold.targetReps + ' reps');
      _setEl('ptExercise', threshold.exerciseType || 'Exercise');
      _setEl('ptMotionLimit', threshold.motionLimit + ' °/s');
      _setEl('ptTempLimit', threshold.tempLimit + ' °C');
      document.getElementById('ptThreshCard')?.classList.remove('hidden');
      document.getElementById('ptNoThresh')?.classList.add('hidden');
    } else {
      document.getElementById('ptThreshCard')?.classList.add('hidden');
      document.getElementById('ptNoThresh')?.classList.remove('hidden');
    }

    const history = await Auth.getExerciseHistoryForPatient(patient.id);
    _setEl('ptTotalSessions', history.length);
    const completed = history.filter(h => h.status === 'completed').length;
    _setEl('ptCompliance', history.length > 0 ? Math.round(completed / history.length * 100) + '%' : '—');
    const lastSession = history[0];
    _setEl('ptLastSession', lastSession ? new Date(lastSession.date).toLocaleDateString() : 'None yet');
  }

  function processSensorForReps(data) {
    if (!sessionActive || !threshold) return;

    const pitch = data._pitch !== undefined ? data._pitch : 0;
    const absPitch = Math.abs(pitch);
    const gyroMag = Math.sqrt((data.gx || 0) ** 2 + (data.gy || 0) ** 2 + (data.gz || 0) ** 2);
    const temp = data.tp || 0;

    sessionAngles.push(absPitch);
    sessionTemps.push(temp);

    if (absPitch >= threshold.minAngle) {
      wasAboveMin = true;
    } else if (wasAboveMin && absPitch < threshold.minAngle) {
      repCount++;
      repTimestamps.push(Date.now());
      wasAboveMin = false;
      _setEl('ptRepCount', repCount);
      _setEl('ptRepCountBig', repCount);

      if (repCount >= threshold.targetReps && !alertFired) {
        alertFired = true;
        _showExerciseAlert('success', `🎉 Target reached! ${repCount} reps completed!`);
        App.showToast(`Great job! ${repCount} reps done!`, 'success');
      }
    }

    if (absPitch > threshold.maxAngle) {
      _showExerciseAlert('warning', `⚠ Angle too high! ${absPitch.toFixed(1)}° exceeds limit of ${threshold.maxAngle}°. Slow down!`);
    }

    if (gyroMag > (threshold.motionLimit || 100)) {
      _showExerciseAlert('warning', `⚠ Motion too fast! Slow down for safety.`);
    }

    if (temp > (threshold.tempLimit || 40)) {
      _showExerciseAlert('error', `🌡 High temperature detected: ${temp.toFixed(1)}°C. Take a rest!`);
    }

    _setEl('ptLivePitch', absPitch.toFixed(1) + '°');
    _setEl('ptLiveGyro', gyroMag.toFixed(1) + ' °/s');
    _setEl('ptLiveTemp', temp.toFixed(1) + ' °C');

    if (threshold.targetReps > 0) {
      const pct = Math.min(repCount / threshold.targetReps, 1);
      _updateRepRing(pct);
    }
  }

  function _updateRepRing(pct) {
    const ring = document.getElementById('repProgressRing');
    if (!ring) return;
    const circumference = 2 * Math.PI * 54;
    ring.style.strokeDashoffset = circumference - pct * circumference;
    ring.style.stroke = pct >= 1 ? '#22c55e' : pct > 0 ? '#00d4ff' : 'rgba(255,255,255,0.15)';
  }

  function _showExerciseAlert(type, msg) {
    const alertEl = document.getElementById('ptExerciseAlert');
    const alertText = document.getElementById('ptExerciseAlertText');
    if (!alertEl || !alertText) return;
    alertEl.className = `exercise-alert ${type}`;
    alertText.textContent = msg;
    alertEl.classList.remove('hidden');

    if (type !== 'error' && type !== 'success') {
      clearTimeout(alertEl._timeout);
      alertEl._timeout = setTimeout(() => alertEl.classList.add('hidden'), 4000);
    }
  }

  function startExercise() {
    if (!threshold) {
      App.showToast('No thresholds set by your doctor yet. Please wait.', 'error');
      return;
    }

    sessionActive = true;
    sessionStartTime = Date.now();
    repCount = 0;
    wasAboveMin = false;
    alertFired = false;
    sessionAngles = [];
    sessionTemps = [];
    repTimestamps = [];

    _setEl('ptRepCount', 0);
    _setEl('ptRepCountBig', 0);
    _updateRepRing(0);

    document.getElementById('ptStartExercise')?.classList.add('hidden');
    document.getElementById('ptStopExercise')?.classList.remove('hidden');
    document.getElementById('ptExerciseAlert')?.classList.add('hidden');

    App.showToast('Exercise session started! Begin your exercises.', 'success');

    const timerEl = document.getElementById('ptExerciseTimer');
    window._ptTimerInterval = setInterval(() => {
      const elapsed = Date.now() - sessionStartTime;
      const m = Math.floor(elapsed / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      if (timerEl) timerEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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

    const pct = threshold ? repCount / threshold.targetReps : 0;
    const status = pct >= 1 ? 'completed' : pct >= 0.5 ? 'partial' : 'failed';

    document.getElementById('ptStartExercise')?.classList.remove('hidden');
    document.getElementById('ptStopExercise')?.classList.add('hidden');

    _showExerciseAlert(
      status === 'completed' ? 'success' : status === 'partial' ? 'warning' : 'error',
      status === 'completed'
        ? `✓ Session complete! ${repCount} reps in ${_formatDuration(duration_s)}`
        : `Session ended: ${repCount}/${threshold?.targetReps || '?'} reps (${status})`
    );

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

    await renderPatientDashboard();
  }

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
          <div class="h-stat"><span class="h-stat-label">Reps</span><span class="h-stat-val">${h.repsCompleted || 0}/${h.targetReps || '?'}</span></div>
          <div class="h-stat"><span class="h-stat-label">Max Angle</span><span class="h-stat-val">${h.maxAngleReached != null ? h.maxAngleReached.toFixed(1) + '°' : '—'}</span></div>
          <div class="h-stat"><span class="h-stat-label">Avg Temp</span><span class="h-stat-val">${h.avgTemp != null ? h.avgTemp.toFixed(1) + ' °C' : '—'}</span></div>
          <div class="h-stat"><span class="h-stat-label">Status</span><span class="h-stat-val"><span class="status-badge ${h.status}">${h.status}</span></span></div>
        </div>
      </div>
    `).join('');
  }

  function renderPrescriptions() {
    const listEl = document.getElementById('ptPrescriptionList');
    if (!listEl) return;

    if (!prescriptions || prescriptions.length === 0) {
      listEl.innerHTML = `<div class="empty-mini">No exercise videos assigned yet</div>`;
      return;
    }

    listEl.innerHTML = prescriptions.map(p => `
      <div class="history-item">
        <div class="history-meta">
          <span class="history-patient">${p.title || 'Exercise Video'}</span>
          <span class="history-detail">Updated: ${new Date(p.updatedAt || p.createdAt).toLocaleString()}</span>
        </div>
        <div class="thi-notes"><a href="${p.youtubeUrl}" target="_blank" rel="noopener noreferrer">${p.youtubeUrl}</a></div>
        ${p.notes ? `<div class="history-detail" style="margin-top:0.5rem">${p.notes}</div>` : ''}
      </div>
    `).join('');
  }

  async function refreshThreshold(fromRealtime = false) {
    if (!patient) return;
    threshold = await Auth.getThresholdForPatient(patient.id);
    prescriptions = await Auth.getExercisePrescriptionsForPatient(patient.id);
    await renderPatientDashboard();
    await renderPatientHistory();
    renderPrescriptions();
    if (fromRealtime) App.showToast('Doctor updates synced', 'info');
  }

  function bindPatientEvents() {
    document.getElementById('ptStartExercise')?.addEventListener('click', startExercise);
    document.getElementById('ptStopExercise')?.addEventListener('click', stopExercise);
    document.getElementById('ptRefreshThreshold')?.addEventListener('click', () => {
      refreshThreshold().then(() => App.showToast('Thresholds refreshed from doctor', 'info'));
    });
  }

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
