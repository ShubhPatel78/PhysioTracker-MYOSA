# 1. Update patient-portal.js
with open("webapp/js/patient-portal.js", "r") as f:
    pt_js = f.read()

old_start = """  function startExercise() {
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

    _setEl('ptRepCount', 0);
    _setEl('ptRepCountBig', 0);
    _updateRepRing(0);

    document.getElementById('ptStartExercise')?.classList.add('hidden');
    document.getElementById('ptStopExercise')?.classList.remove('hidden');
    document.getElementById('ptExerciseAlert')?.classList.add('hidden');
    document.getElementById('ptMaxLimitAlert')?.classList.add('hidden');

    renderVideoDemo();

    App.showToast('Exercise session started! Follow the demonstration.', 'success');
    // Send BLE exercise selection command if connected
    if (typeof Connection !== 'undefined' && Connection.sendCommand && threshold?.exerciseType) {
      Connection.sendCommand('EX:' + threshold.exerciseType);
    }

    const timerEl = document.getElementById('ptExerciseTimer');
    window._ptTimerInterval = setInterval(() => {
      const elapsed = Date.now() - sessionStartTime;
      const m = Math.floor(elapsed / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      if (timerEl) timerEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }, 500);
  }"""

new_start = """  function startExercise() {
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

    _setEl('ptRepCount', 0);
    _setEl('ptRepCountBig', 0);
    _updateRepRing(0);

    document.getElementById('ptStartExercise')?.classList.add('hidden');
    document.getElementById('ptStopExercise')?.classList.remove('hidden');
    document.getElementById('ptExerciseAlert')?.classList.add('hidden');
    document.getElementById('ptMaxLimitAlert')?.classList.add('hidden');

    renderVideoDemo();

    // Check if hardware sensor is connected
    const isConn = (typeof Connection !== 'undefined' && Connection.getStatus && Connection.getStatus() === 'connected');
    if (isConn) {
      App.showToast('Exercise session started! Hardware sensor is active.', 'success');
      Connection.sendCommand('EX:' + threshold.exerciseType);
    } else {
      // Auto-activate demo simulation so patient/tester can see reps even without hardware
      App.showToast('Starting exercise session (Simulated Movement Mode)', 'info');
      App.startDemo();
    }

    const timerEl = document.getElementById('ptExerciseTimer');
    window._ptTimerInterval = setInterval(() => {
      const elapsed = Date.now() - sessionStartTime;
      const m = Math.floor(elapsed / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      if (timerEl) timerEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }, 500);
  }"""

pt_js = pt_js.replace(old_start, new_start)

# In stopExercise, ensure demo stops if it was started
pt_js = pt_js.replace("sessionActive = false;\n    clearInterval(window._ptTimerInterval);", "sessionActive = false;\n    clearInterval(window._ptTimerInterval);\n    if (App.isDemo && App.isDemo()) { App.stopDemo(); }")

with open("webapp/js/patient-portal.js", "w") as f:
    f.write(pt_js)

# 2. Update index.html to add quick BLE button on exercise header
with open("webapp/index.html", "r") as f:
    idx = f.read()

old_header = """      <div class="page-header">
        <h1>Exercise Session</h1>
        <div class="page-meta">
          <span class="exercise-timer mono" id="ptExerciseTimer">00:00</span>
        </div>
      </div>"""

new_header = """      <div class="page-header">
        <h1>Exercise Session</h1>
        <div class="page-meta" style="display:flex;gap:0.75rem;align-items:center">
          <button class="btn-secondary btn-sm" id="ptQuickBleBtn" style="display:flex;align-items:center;gap:0.35rem">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11"/></svg>
            Connect BLE Sensor
          </button>
          <span class="exercise-timer mono" id="ptExerciseTimer">00:00</span>
        </div>
      </div>"""

idx = idx.replace(old_header, new_header)

with open("webapp/index.html", "w") as f:
    f.write(idx)

# 3. Add event handler for quick BLE button in patient-portal.js
with open("webapp/js/patient-portal.js", "r") as f:
    pt_js = f.read()

bind_quick_ble = """    document.getElementById('ptQuickBleBtn')?.addEventListener('click', () => {
      Connection.connect({ mode: 'ble' });
    });\n"""

pt_js = pt_js.replace("function bindEvents() {", "function bindEvents() {\n" + bind_quick_ble)

with open("webapp/js/patient-portal.js", "w") as f:
    f.write(pt_js)

print("Patient exercise enhancements applied successfully!")
