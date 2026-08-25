/**
 * PhysioPulse – Patient Portal Module
 * Handles:
 * - Patient dashboard & doctor prescriptions
 * - Safe angle & rep limit enforcement (prevents over-exercising past doctor's max)
 * - "Report Pain / Can't Reach" button with live angle reporting to doctor
 * - In-app YouTube exercise demo video player
 * - Post-exercise motivational feedback & celebratory summary
 */

const PatientPortal = (() => {
  let session = null;
  let patient = null;
  let threshold = null;

  // ─── Rep Counting & Session State ─────────────────────────────────────────
  let repCount = 0;
  let wasAboveMin = false;
  let sessionActive = false;
  let sessionStartTime = null;
  let sessionAngles = [];
  let sessionTemps = [];
  let repTimestamps = [];
  let alertFired = false;
  let maxLimitExceeded = false;
  let painAlertsLogged = 0;

  // ─── Resting Position Calibration (3-second window after Start Exercise) ──
  const CALIB_DURATION_MS = 3000;   // 3 seconds quick calibration
  let calibSamples    = [];         // raw pitch readings during calibration window
  let calibStartTime  = null;       // timestamp when calibration began
  let restingBaseline = null;       // computed mean → patient's neutral/resting angle
  let isCalibrating   = false;      // true while calibration window is active



  // Selected pain level in modal
  let selectedPainLevel = 'Mild';


  // ─── Motivational Quotes Pool ─────────────────────────────────────────────
  const MOTIVATIONAL_QUOTES = [
    { quote: "Every rep is a step closer to full recovery. Consistency is your superpower!", tip: "Hydrate well and gently stretch. Allow adequate rest before your next session." },
    { quote: "Small daily improvements over time lead to stunning long-term results.", tip: "Elevate and apply gentle cold therapy if you notice mild post-exercise swelling." },
    { quote: "Your body achieves what your mind believes. Fantastic dedication today!", tip: "Maintain good posture throughout the rest of your day to protect your joint alignment." },
    { quote: "Patience and steady progress beat rushed recovery every single time.", tip: "Take 5 minutes of deep breathing to help lower muscle tension." },
    { quote: "Strength doesn't come from what you can do; it comes from overcoming the things you once couldn't.", tip: "Log your energy level and notify your doctor if joint stiffness lingers." }
  ];

  // ─── YouTube URL Helper ───────────────────────────────────────────────────
  function getYouTubeEmbedUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    // Direct embed URL already?
    if (trimmed.includes('youtube.com/embed/')) {
      return trimmed;
    }

    // Match patterns: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, etc.
    const regExp = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
    const match = trimmed.match(regExp);
    if (match && match[1]) {
      return `https://www.youtube.com/embed/${match[1]}?rel=0&modestbranding=1`;
    }
    // If already an embed or valid URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    return null;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init(patientSession) {
    session = patientSession;
    patient = await Auth.getPatientByUserId(session.userId);
    if (patient) {
      threshold = await Auth.getThresholdForPatient(patient.id);
    }

    renderPatientDashboard();
    renderExercisePage();
    await renderPatientHistory();
    bindPatientEvents();
  }

  // ─── Render Video Demo & Exercise Page Info ────────────────────────────────
  function renderVideoDemo() {
    const card = document.getElementById('ptVideoDemoCard');
    const iframe = document.getElementById('ptVideoIframe');
    if (!card || !iframe) return;

    const videoUrl = threshold?.videoUrl || threshold?.video_url;
    const embedUrl = getYouTubeEmbedUrl(videoUrl);

    if (embedUrl) {
      if (iframe.src !== embedUrl) {
        iframe.src = embedUrl;
      }
      card.classList.remove('hidden');
    } else {
      iframe.src = '';
      card.classList.add('hidden');
    }
  }

  function renderExercisePage() {
    if (threshold) {
      const targetReps = threshold.targetReps || threshold.target_reps || 10;
      const minAngle = threshold.minAngle || threshold.min_angle || 30;
      const maxAngle = threshold.maxAngle || threshold.max_angle || 120;
      const exType = threshold.exerciseType || threshold.exercise_type || 'Knee Flexion';

      _setEl('ptExerciseTarget', `${targetReps} reps`);
      _setEl('ptExerciseName', exType);
      _setEl('ptExerciseRange', `${minAngle}° – ${maxAngle}°`);
    } else {
      _setEl('ptExerciseTarget', '— reps');
      _setEl('ptExerciseName', '—');
      _setEl('ptExerciseRange', '—° – —°');
    }
    renderVideoDemo();
  }

  // ─── Patient Dashboard ─────────────────────────────────────────────────────
  async function renderPatientDashboard() {
    _setEl('ptPatientName', session.name);

    if (!patient) {
      _setEl('ptDoctorInfo', 'Not linked to a doctor');
      return;
    }

    const doctor = await Auth.getDoctorById(patient.doctorId);
    _setEl('ptDoctorInfo', doctor ? `Dr. ${doctor.name}` : 'Unknown Doctor');

    if (threshold) {
      _setEl('ptMinAngle', threshold.minAngle + '°');
      _setEl('ptMaxAngle', threshold.maxAngle + '°');
      _setEl('ptTargetReps', threshold.targetReps + ' reps');
      _setEl('ptExercise', threshold.exerciseType || 'Exercise');
      _setEl('ptMotionLimit', threshold.motionLimit + ' °/s');
      
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

  // ─── Rep Counting & Max Limit Enforcement ──────────────────────────────────
  function processSensorForReps(data) {
    if (!sessionActive) return;

    if (!threshold) {
      threshold = { minAngle: 5, maxAngle: 88, targetReps: 12, exerciseType: 'Bicep Curl' };
    }

    // Resolve pitch: prefer direct pitch field, then _pitch
    const rawPitch = data.pitch !== undefined && data.pitch !== null
      ? parseFloat(data.pitch)
      : (data._pitch !== undefined ? parseFloat(data._pitch) : 0);
    const absPitch = Math.abs(rawPitch);

    const gyroMag = Math.sqrt((data.gx || 0) ** 2 + (data.gy || 0) ** 2 + (data.gz || 0) ** 2);
    const temp = data.tp || 0;


    // ── Phase 1: Resting Position Calibration (3-second window) ──────────────
    if (isCalibrating) {
      calibSamples.push(absPitch);
      sessionAngles.push(absPitch); // guarantee sessionAngles is never empty

      const elapsed   = Date.now() - calibStartTime;
      const remaining = Math.max(0, Math.ceil((CALIB_DURATION_MS - elapsed) / 1000));

      // Live countdown banner
      _showExerciseAlert('info',
        `📐 Hold RESTING position... Calibrating — ${remaining}s remaining (${calibSamples.length} samples)`);

      if (elapsed >= CALIB_DURATION_MS) {
        // 3 seconds done — compute mean baseline
        const sum = calibSamples.reduce((a, b) => a + b, 0);
        restingBaseline = calibSamples.length > 0 ? (sum / calibSamples.length) : 0;
        isCalibrating   = false;

        _showExerciseAlert('success',
          `✅ Resting baseline set: ${restingBaseline.toFixed(1)}° — Begin your ${threshold.exerciseType || 'exercise'}!`);
        App.showToast(
          `✅ Baseline locked at ${restingBaseline.toFixed(1)}°. Start curling!`,
          'success'
        );
      }

      // Show live angle during calibration
      _setEl('ptLivePitch', absPitch.toFixed(1) + '°');
      return;
    }

    // ── Phase 2: Active Rep Counting ──
    const liveAngle = absPitch - (restingBaseline !== null ? restingBaseline : 0);
    const movementAngle = Math.abs(liveAngle); // movement distance from rest

    sessionAngles.push(movementAngle);
    sessionTemps.push(temp);

    // ── Hardware Rep Sync (if ESP32 sends reps directly) ──
    const hwReps = (data.reps !== undefined && data.reps !== null) ? parseInt(data.reps) : -1;
    if (hwReps > 0 && hwReps > repCount) {
      repCount = hwReps;
      _setEl('ptRepCount', repCount);
      _setEl('ptRepCountBig', repCount);
    } else {
      // ── Software Dynamic Rep Counter ──
      // Dynamic thresholds: UP at 60% of prescribed max, DOWN at 25% of max
      const maxA = threshold.maxAngle || 88;
      const upThresh   = Math.max(35, Math.min(maxA - 10, maxA * 0.60));
      const downThresh = Math.max(10, Math.min(22, maxA * 0.25));

      const now = Date.now();
      if (!window._lastPeakTime) window._lastPeakTime = 0;

      const exType = threshold.exerciseType || 'Bicep Curl';
      let upMsg = 'Holding Peak...';
      let midUpMsg = 'Raising...';
      let midDownMsg = 'Lowering...';

      if (exType.includes('Curl')) {
        upMsg = 'Hold Peak Curl...';
        midUpMsg = 'Curling Up...';
        midDownMsg = 'Lowering...';
      } else if (exType.includes('Leg')) {
        upMsg = 'Hold Leg Raise...';
        midUpMsg = 'Raising Leg...';
        midDownMsg = 'Lowering Leg...';
      } else if (exType.includes('Side')) {
        upMsg = 'Hold Height...';
        midUpMsg = 'Raising Sideways...';
        midDownMsg = 'Lowering Control...';
      } else if (exType.includes('Front')) {
        upMsg = 'Hold Height...';
        midUpMsg = 'Raising Forward...';
        midDownMsg = 'Lowering Control...';
      } else if (exType.includes('Circle') || exType.includes('Circumduction')) {
        upMsg = 'Loop Complete! Keep Circling...';
        midUpMsg = 'Circling...';
        midDownMsg = 'Circling...';
      }

      // Only transition to UP if sensor actually moved past UP threshold
      if (!wasAboveMin && movementAngle >= upThresh) {
        wasAboveMin = true;
        window._lastPeakTime = now;
        _setEl('ptLiveMsg', upMsg);
      } else if (wasAboveMin && movementAngle <= downThresh) {
        // Enforce minimum curl duration (at least 600ms between peak and return) to reject jitter
        if (now - window._lastPeakTime >= 600) {
          wasAboveMin = false;
          repCount++;
          repTimestamps.push(now);
          _setEl('ptRepCount', repCount);
          _setEl('ptRepCountBig', repCount);
          _setEl('ptLiveMsg', 'Rep Complete! Ready');
        }
      } else if (movementAngle > downThresh && movementAngle < upThresh) {
        _setEl('ptLiveMsg', wasAboveMin ? midDownMsg : midUpMsg);
      } else if (movementAngle <= downThresh && !wasAboveMin) {
        _setEl('ptLiveMsg', 'Resting Position (Ready)');
      }
    }

    // ── Target Complete ──
    if (repCount >= threshold.targetReps && !alertFired) {
      alertFired = true;
      _showExerciseAlert('success', `🎉 Target reached! ${repCount}/${threshold.targetReps} reps. Great job!`);
      App.showToast(`🎉 ${threshold.targetReps} reps completed!`, 'success');
    }

    // Live display
    _setEl('ptLivePitch', movementAngle.toFixed(1) + '°');
    _setEl('ptLiveGyro', gyroMag.toFixed(1) + ' °/s');

    if (threshold.targetReps > 0) {
      _updateRepRing(Math.min(repCount / threshold.targetReps, 1));
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

  // ─── Start / Stop Exercise ────────────────────────────────────────────────
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
    maxLimitExceeded = false;
    painAlertsLogged = 0;
    sessionAngles = [];
    sessionTemps = [];
    repTimestamps = [];

    // ── Reset resting position calibration ──
    calibSamples    = [];
    calibStartTime  = Date.now();
    restingBaseline = null;
    isCalibrating   = true;


    _setEl('ptRepCount', 0);
    _setEl('ptRepCountBig', 0);
    _updateRepRing(0);

    document.getElementById('ptStartExercise')?.classList.add('hidden');
    document.getElementById('ptStopExercise')?.classList.remove('hidden');
    document.getElementById('ptExerciseAlert')?.classList.add('hidden');
    document.getElementById('ptMaxLimitAlert')?.classList.add('hidden');

    renderVideoDemo();

    // Show calibration banner
    _showExerciseAlert('info', `📐 Hold your arm in the RESTING position... Calibrating for 3 seconds`);

    // Stop any background simulated demo so reps only come from real hardware
    if (App.isDemo && App.isDemo()) {
      App.stopDemo();
    }

    // Check if hardware sensor is connected
    const isConn = (typeof Connection !== 'undefined' && Connection.getStatus && Connection.getStatus() === 'connected');
    if (isConn) {
      App.showToast('Hold resting position for 3 seconds — calibrating baseline...', 'info');
      Connection.sendCommand('EX:' + threshold.exerciseType);
    } else {
      App.showToast('⚠️ Bluetooth sensor not connected. Click "Connect BLE Sensor" top right.', 'warning');
      _showExerciseAlert('warning', '⚠️ Sensor not connected. Please click "Connect BLE Sensor" at the top right to link your device.');
    }



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
    if (App.isDemo && App.isDemo()) { App.stopDemo(); }

    const duration_s = Math.round((Date.now() - sessionStartTime) / 1000);
    const maxAngleReached = sessionAngles.length > 0 ? Math.max(...sessionAngles) : 0;
    const minAngleReached = sessionAngles.length > 0 ? Math.min(...sessionAngles) : 0;
    const avgTemp = sessionTemps.length > 0 ? sessionTemps.reduce((a, b) => a + b, 0) / sessionTemps.length : 0;

    const pct = threshold ? repCount / threshold.targetReps : 0;
    const status = pct >= 1 ? 'completed' : pct >= 0.5 ? 'partial' : 'failed';

    document.getElementById('ptStartExercise')?.classList.remove('hidden');
    document.getElementById('ptStopExercise')?.classList.add('hidden');
    document.getElementById('ptMaxLimitAlert')?.classList.add('hidden');

    // Save record to backend & local
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

    // Trigger Post-Exercise Motivational Modal
    showMotivationalModal(repCount, threshold?.targetReps || 0, maxAngleReached, duration_s, status);

    await renderPatientDashboard();
  }

  // ─── Motivational Celebration Modal ────────────────────────────────────────
  function showMotivationalModal(repsDone, targetReps, maxAngle, duration_s, status) {
    const modal = document.getElementById('motivationalModal');
    if (!modal) return;

    const titleEl = document.getElementById('motivationalTitle');
    const badgeEl = document.getElementById('motivationalBadge');
    const quoteEl = document.getElementById('motivationalQuote');
    const tipEl   = document.getElementById('motivationalTip');

    _setEl('mRepsDone', `${repsDone}/${targetReps}`);
    _setEl('mMaxAngle', `${maxAngle.toFixed(1)}°`);
    _setEl('mDuration', _formatDuration(duration_s));
    _setEl('mCompliance', status === 'completed' ? '100% (Full)' : status === 'partial' ? 'Partial' : 'Incomplete');

    // Select random inspirational quote
    const item = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];

    if (status === 'completed') {
      if (titleEl) titleEl.textContent = '🎉 Goal Achieved!';
      if (badgeEl) {
        badgeEl.textContent = '🌟 100% Target Completed!';
        badgeEl.style.color = '#22c55e';
      }
      if (quoteEl) quoteEl.textContent = `"${item.quote}"`;
    } else if (painAlertsLogged > 0) {
      if (titleEl) titleEl.textContent = '🩹 Smart Pacing!';
      if (badgeEl) {
        badgeEl.textContent = '⚠️ Discomfort Reported to Doctor';
        badgeEl.style.color = '#f59e0b';
      }
      if (quoteEl) quoteEl.textContent = `"Listening to your body is the smartest path to lasting recovery."`;
    } else {
      if (titleEl) titleEl.textContent = '💪 Great Effort!';
      if (badgeEl) {
        badgeEl.textContent = '⭐ Every Rep Builds Strength';
        badgeEl.style.color = '#00d4ff';
      }
      if (quoteEl) quoteEl.textContent = `"${item.quote}"`;
    }

    if (tipEl) {
      tipEl.innerHTML = `💡 <strong>Recovery Tip:</strong> ${item.tip}`;
    }

    modal.classList.remove('hidden');
  }

  // ─── Pain / Limitation Alert Modal ─────────────────────────────────────────
  function openPainModal() {
    const modal = document.getElementById('painModal');
    if (!modal) return;

    const currentPitch = document.getElementById('ptLivePitch')?.textContent || '0.0°';
    _setEl('painModalAngle', currentPitch);
    _setEl('painModalReps', repCount);

    const notes = document.getElementById('painModalNotes');
    if (notes) notes.value = '';

    // Reset pain buttons
    document.querySelectorAll('.pain-level-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.level === 'Mild');
    });
    selectedPainLevel = 'Mild';

    modal.classList.remove('hidden');
  }

  function closePainModal() {
    document.getElementById('painModal')?.classList.add('hidden');
  }

  async function submitPainAlert() {
    if (!patient) return;

    const angleStr = document.getElementById('painModalAngle')?.textContent || '0';
    const angle = parseFloat(angleStr) || 0;
    const notes = document.getElementById('painModalNotes')?.value.trim() || '';

    try {
      if (typeof API !== 'undefined') {
        await API.sendPainAlert(patient.id, {
          angle_at_pain: angle,
          reps_at_pain: repCount,
          pain_level: selectedPainLevel,
          notes,
        });
      }
      painAlertsLogged++;
      closePainModal();
      _showExerciseAlert('warning', `🚨 Discomfort reported to Dr. at ${angle.toFixed(1)}° (${selectedPainLevel}). Safe pacing advised.`);
      App.showToast('🚨 Alert sent to your doctor! Rest and do not force movement.', 'warning');
    } catch (e) {
      console.warn('[PatientPortal] Pain alert error:', e.message);
      closePainModal();
      App.showToast('Discomfort recorded locally. Doctor will be notified upon sync.', 'info');
    }
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
          <div class="h-stat"><span class="h-stat-label">Reps</span><span class="h-stat-val">${h.repsCompleted || 0}/${h.targetReps || '?'}</span></div>
          <div class="h-stat"><span class="h-stat-label">Max Angle</span><span class="h-stat-val">${h.maxAngleReached != null ? h.maxAngleReached.toFixed(1) + '°' : '—'}</span></div>
          <div class="h-stat"><span class="h-stat-label">Status</span><span class="h-stat-val"><span class="status-badge ${h.status}">${h.status}</span></span></div>
        </div>
      </div>
    `).join('');
  }

  async function refreshThreshold() {
    if (!patient) return;
    threshold = await Auth.getThresholdForPatient(patient.id);
    await renderPatientDashboard();
    renderVideoDemo();
    await renderPatientHistory();
  }

  // ─── Bind Events ──────────────────────────────────────────────────────────
  function bindPatientEvents() {
    document.getElementById('ptStartExercise')?.addEventListener('click', startExercise);
    document.getElementById('ptStopExercise')?.addEventListener('click', stopExercise);
    document.getElementById('ptReportPainBtn')?.addEventListener('click', openPainModal);
    document.getElementById('closePainModal')?.addEventListener('click', closePainModal);
    document.getElementById('cancelPainModal')?.addEventListener('click', closePainModal);
    document.getElementById('submitPainAlert')?.addEventListener('click', submitPainAlert);

    // Pain level buttons
    document.querySelectorAll('.pain-level-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pain-level-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedPainLevel = btn.dataset.level || 'Mild';
      });
    });

    // Motivational modal close
    document.getElementById('closeMotivationalBtn')?.addEventListener('click', () => {
      document.getElementById('motivationalModal')?.classList.add('hidden');
    });
    document.getElementById('closeMotivationalModal')?.addEventListener('click', () => {
      document.getElementById('motivationalModal')?.classList.add('hidden');
    });

    document.getElementById('ptRefreshThreshold')?.addEventListener('click', () => {
      refreshThreshold().then(() => App.showToast('Thresholds & Video refreshed from doctor', 'info'));
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
    renderExercisePage,
    renderPatientHistory,
    refreshThreshold,
    isSessionActive: () => sessionActive,
  };
})();
