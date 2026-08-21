/**
 * PhysioPulse – Doctor Portal Module
 * Manages: patient list, first-time baseline data entry, threshold management,
 * patient history view, threshold history.
 */

const DoctorPortal = (() => {
  let session = null; // current doctor session

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init(doctorSession) {
    session = doctorSession;
    await renderDoctorDashboard();
    bindDoctorEvents();
  }

  // ─── Doctor Dashboard ─────────────────────────────────────────────────────
  async function renderDoctorDashboard() {
    // Update doctor info in the UI
    const nameEl = document.getElementById('doctorName');
    const codeEl = document.getElementById('doctorCode');
    if (nameEl) nameEl.textContent = session.name;
    if (codeEl) codeEl.textContent = session.doctorCode || 'DR0001';

    // Count patients
    const patients = await Auth.getPatientsByDoctorId(session.userId);
    const countEl = document.getElementById('doctorPatientCount');
    if (countEl) countEl.textContent = patients.length;

    // Recent alerts
    await renderRecentAlerts(patients);

    // Patient list in doctor dashboard
    await renderPatientCards(patients);
  }

  async function renderRecentAlerts(patients) {
    const alertsEl = document.getElementById('doctorAlertsList');
    if (!alertsEl) return;

    let alerts = [];
    for (const p of patients) {
      const history = await Auth.getExerciseHistoryForPatient(p.id);
      const failedSessions = history.filter(h => h.status === 'failed' || h.status === 'partial');
      failedSessions.slice(0, 3).forEach(h => {
        alerts.push({ patient: p.name, date: h.date, status: h.status, reps: h.repsCompleted, target: h.targetReps });
      });
    }

    alerts.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = alerts.slice(0, 5);

    if (recent.length === 0) {
      alertsEl.innerHTML = `<div class="empty-mini">No alerts – all patients on track ✓</div>`;
      return;
    }

    alertsEl.innerHTML = recent.map(a => `
      <div class="alert-item ${a.status}">
        <div class="alert-patient-name">${a.patient}</div>
        <div class="alert-detail">${new Date(a.date).toLocaleDateString()} – ${a.reps || 0}/${a.target || '?'} reps (${a.status})</div>
      </div>
    `).join('');
  }

  async function renderPatientCards(patients) {
    const listEl = document.getElementById('doctorPatientCards');
    if (!listEl) return;

    if (patients.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <h2>No patients yet</h2>
          <p>Share your Doctor Code <strong>${session.doctorCode || 'DR????'}</strong> with patients for them to register and link to you.</p>
        </div>`;
      return;
    }

    const cards = await Promise.all(patients.map(async (p) => {
      const threshold = await Auth.getThresholdForPatient(p.id);
      const history   = await Auth.getExerciseHistoryForPatient(p.id);
      const lastSession = history[0];
      const compliance = history.length > 0
        ? Math.round(history.filter(h => h.status === 'completed').length / history.length * 100)
        : null;

      return `
        <div class="patient-card" data-patient-id="${p.id}" onclick="DoctorPortal.openPatientDetail(${p.id})">
          <div class="pc-header">
            <div class="pc-avatar">${(p.name || 'P').charAt(0).toUpperCase()}</div>
            <div class="pc-info">
              <div class="pc-name">${p.name}</div>
              <div class="pc-meta">${p.condition || 'No condition set'} · Age: ${p.age || '—'}</div>
            </div>
            <div class="pc-compliance ${compliance === null ? '' : compliance >= 80 ? 'good' : compliance >= 50 ? 'warn' : 'bad'}">
              ${compliance === null ? '—' : compliance + '%'}
            </div>
          </div>
          <div class="pc-thresholds">
            ${threshold ? `
              <span class="pc-thresh-item">Min Angle: <strong>${threshold.minAngle}°</strong></span>
              <span class="pc-thresh-item">Max Angle: <strong>${threshold.maxAngle}°</strong></span>
              <span class="pc-thresh-item">Target Reps: <strong>${threshold.targetReps}</strong></span>
            ` : `<span class="pc-thresh-none">No thresholds set yet</span>`}
          </div>
          <div class="pc-footer">
            <span class="pc-last">${lastSession ? 'Last: ' + new Date(lastSession.date).toLocaleDateString() : 'No sessions yet'}</span>
            <span class="pc-sessions">${history.length} sessions</span>
          </div>
        </div>
      `;
    }));

    listEl.innerHTML = cards.join('');
  }

  // ─── Patient Detail / Threshold Form ─────────────────────────────────────
  async function openPatientDetail(patientId) {
    const patient   = await Auth._dbGet('patients', patientId);
    const threshold = await Auth.getThresholdForPatient(patientId);
    const history   = await Auth.getExerciseHistoryForPatient(patientId);
    const thresholdHistory = await Auth.getThresholdHistoryForPatient(patientId);

    // Navigate to patient detail page
    App.navigateTo('doctor-patient');

    // Fill in patient info
    _setEl('dpPatientName', patient.name);
    _setEl('dpPatientAge', patient.age || '—');
    _setEl('dpPatientCondition', patient.condition || 'Not specified');
    _setEl('dpSessionCount', history.length);

    const compliance = history.length > 0
      ? Math.round(history.filter(h => h.status === 'completed').length / history.length * 100)
      : null;
    _setEl('dpCompliance', compliance !== null ? compliance + '%' : '—');

    // Fill threshold form
    if (threshold) {
      _setVal('dpMinAngle', threshold.minAngle);
      _setVal('dpMaxAngle', threshold.maxAngle);
      _setVal('dpTargetReps', threshold.targetReps);
      _setVal('dpMotionLimit', threshold.motionLimit || 100);
      _setVal('dpTempLimit', threshold.tempLimit || 40);
      _setVal('dpExerciseType', threshold.exerciseType || 'Knee Flexion / Extension');
      _setVal('dpNotes', threshold.notes || '');
    } else {
      _setVal('dpMinAngle', 30);
      _setVal('dpMaxAngle', 120);
      _setVal('dpTargetReps', 10);
      _setVal('dpMotionLimit', 100);
      _setVal('dpTempLimit', 40);
      _setVal('dpNotes', '');
    }

    // Store patient ID in form for save action
    const form = document.getElementById('thresholdForm');
    if (form) form.dataset.patientId = patientId;

    // Patient profile edit fields
    _setVal('dpEditName', patient.name);
    _setVal('dpEditAge', patient.age || '');
    _setVal('dpEditCondition', patient.condition || '');
    const profileForm = document.getElementById('patientProfileForm');
    if (profileForm) profileForm.dataset.patientId = patientId;

    // Exercise history table
    renderPatientHistory(history, threshold);

    // Threshold history
    renderThresholdHistory(thresholdHistory);
  }

  function renderPatientHistory(history, threshold) {
    const histEl = document.getElementById('dpHistoryTable');
    if (!histEl) return;

    if (history.length === 0) {
      histEl.innerHTML = `<div class="empty-mini">No exercise sessions recorded yet</div>`;
      return;
    }

    histEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Reps</th>
            <th>Max Angle</th>
            <th>Min Angle</th>
            <th>Avg Temp</th>
            <th>Status</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${history.map(h => `
            <tr>
              <td>${new Date(h.date).toLocaleString()}</td>
              <td>${h.repsCompleted || 0}${threshold ? '/' + threshold.targetReps : ''}</td>
              <td>${h.maxAngleReached != null ? h.maxAngleReached.toFixed(1) + '°' : '—'}</td>
              <td>${h.minAngleReached != null ? h.minAngleReached.toFixed(1) + '°' : '—'}</td>
              <td>${h.avgTemp != null ? h.avgTemp.toFixed(1) + ' °C' : '—'}</td>
              <td><span class="status-badge ${h.status}">${h.status}</span></td>
              <td>${h.duration_s ? _formatDuration(h.duration_s) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderThresholdHistory(history) {
    const el = document.getElementById('dpThresholdHistory');
    if (!el) return;

    if (history.length === 0) {
      el.innerHTML = `<div class="empty-mini">No threshold changes recorded</div>`;
      return;
    }

    el.innerHTML = history.map((t, i) => `
      <div class="thresh-history-item ${i === 0 ? 'current' : ''}">
        <div class="thi-date">${new Date(t.updatedAt).toLocaleString()} ${i === 0 ? '<span class="current-badge">Current</span>' : ''}</div>
        <div class="thi-values">
          Min: ${t.minAngle}° · Max: ${t.maxAngle}° · Reps: ${t.targetReps} · Motion: ${t.motionLimit || 100}°/s
        </div>
        ${t.notes ? `<div class="thi-notes">${t.notes}</div>` : ''}
      </div>
    `).join('');
  }

  // ─── Save Threshold ────────────────────────────────────────────────────────
  async function saveThreshold() {
    const form = document.getElementById('thresholdForm');
    if (!form) return;
    const patientId = parseInt(form.dataset.patientId);

    const minAngle  = parseFloat(document.getElementById('dpMinAngle')?.value) || 30;
    const maxAngle  = parseFloat(document.getElementById('dpMaxAngle')?.value) || 120;
    const targetReps= parseInt(document.getElementById('dpTargetReps')?.value)  || 10;
    const motionLimit= parseFloat(document.getElementById('dpMotionLimit')?.value) || 100;
    const tempLimit  = parseFloat(document.getElementById('dpTempLimit')?.value)  || 40;
    const exerciseType = document.getElementById('dpExerciseType')?.value || 'Knee Flexion / Extension';
    const notes      = document.getElementById('dpNotes')?.value.trim() || '';

    if (minAngle >= maxAngle) {
      App.showToast('Min angle must be less than max angle', 'error');
      return;
    }

    try {
      await Auth.saveThreshold({
        patientId,
        doctorId: session.userId,
        minAngle,
        maxAngle,
        targetReps,
        motionLimit,
        tempLimit,
        exerciseType,
        notes,
      });

      // Mark patient as having baseline data
      const patient = await Auth._dbGet('patients', patientId);
      patient.hasBaselineData = true;
      patient.condition = patient.condition || exerciseType;
      await Auth.updatePatientProfile(patient);

      App.showToast('Thresholds saved successfully!', 'success');

      // Refresh threshold history
      const threshHistory = await Auth.getThresholdHistoryForPatient(patientId);
      renderThresholdHistory(threshHistory);

      // Refresh patient cards
      const patients = await Auth.getPatientsByDoctorId(session.userId);
      await renderPatientCards(patients);

    } catch (e) {
      console.error('[DoctorPortal] Threshold save error:', e);
      App.showToast('Error saving thresholds: ' + e.message, 'error');
    }
  }

  // ─── Save Patient Profile ─────────────────────────────────────────────────
  async function savePatientProfile() {
    const form = document.getElementById('patientProfileForm');
    if (!form) return;
    const patientId = parseInt(form.dataset.patientId);

    const name      = document.getElementById('dpEditName')?.value.trim();
    const age       = parseInt(document.getElementById('dpEditAge')?.value) || null;
    const condition = document.getElementById('dpEditCondition')?.value.trim() || '';

    if (!name) { App.showToast('Patient name is required', 'error'); return; }

    try {
      const patient = await Auth._dbGet('patients', patientId);
      patient.name = name;
      patient.age = age;
      patient.condition = condition;
      await Auth.updatePatientProfile(patient);

      _setEl('dpPatientName', name);
      _setEl('dpPatientAge', age || '—');
      _setEl('dpPatientCondition', condition || 'Not specified');

      App.showToast('Patient profile updated!', 'success');
    } catch (e) {
      App.showToast('Error updating profile: ' + e.message, 'error');
    }
  }

  // ─── Bind Events ──────────────────────────────────────────────────────────
  function bindDoctorEvents() {
    document.getElementById('thresholdSaveBtn')?.addEventListener('click', saveThreshold);
    document.getElementById('patientProfileSaveBtn')?.addEventListener('click', savePatientProfile);
    document.getElementById('backToPatients')?.addEventListener('click', () => {
      App.navigateTo('doctor-patients');
    });

    // Doctor patients nav refresh
    document.getElementById('nav-doctor-patients')?.addEventListener('click', async () => {
      const patients = await Auth.getPatientsByDoctorId(session.userId);
      await renderPatientCards(patients);
    });

    document.getElementById('nav-doctor-dashboard')?.addEventListener('click', renderDoctorDashboard);
  }

  // ─── Refresh (called after role changes) ─────────────────────────────────
  async function refresh() {
    const patients = await Auth.getPatientsByDoctorId(session.userId);
    await renderPatientCards(patients);
    await renderDoctorDashboard();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function _setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  function _setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
  function _formatDuration(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  return { init, refresh, openPatientDetail, saveThreshold, savePatientProfile };
})();
