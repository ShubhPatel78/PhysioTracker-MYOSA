/**
 * PhysioPulse – Auth + Data Module (Supabase backend)
 * Uses userId + password authentication and realtime data access.
 */

const Auth = (() => {
  const SESSION_KEY = 'pp_session';
  const SESSION_EXPIRY_MS = 8 * 60 * 60 * 1000;
  const SALT = 'physiopulse_salt_v2';

  let supabase = null;
  const realtimeChannels = new Set();

  function getConfig() {
    const cfg = window.PHYSIOPULSE_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      throw new Error('Backend is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in webapp/js/backend-config.js');
    }
    return cfg;
  }

  function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, expiry: Date.now() + SESSION_EXPIRY_MS }));
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() > data.expiry) {
        clearSession();
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + SALT);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function normalizePatient(p) {
    if (!p) return null;
    return {
      id: p.id,
      userId: p.user_id,
      doctorId: p.doctor_id,
      name: p.name,
      age: p.age,
      condition: p.condition || '',
      hasBaselineData: !!p.has_baseline_data,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }

  function normalizeThreshold(t) {
    if (!t) return null;
    return {
      id: t.id,
      patientId: t.patient_id,
      doctorId: t.doctor_id,
      minAngle: t.min_angle,
      maxAngle: t.max_angle,
      targetReps: t.target_reps,
      motionLimit: t.motion_limit,
      tempLimit: t.temp_limit,
      exerciseType: t.exercise_type,
      notes: t.notes || '',
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    };
  }

  function normalizeExerciseRecord(r) {
    if (!r) return null;
    return {
      id: r.id,
      patientId: r.patient_id,
      doctorId: r.doctor_id,
      date: r.date,
      repsCompleted: r.reps_completed,
      targetReps: r.target_reps,
      maxAngleReached: r.max_angle_reached,
      minAngleReached: r.min_angle_reached,
      avgTemp: r.avg_temp,
      duration_s: r.duration_s,
      status: r.status,
      exerciseType: r.exercise_type,
    };
  }

  function normalizePrescription(p) {
    if (!p) return null;
    return {
      id: p.id,
      patientId: p.patient_id,
      doctorId: p.doctor_id,
      youtubeUrl: p.youtube_url,
      title: p.title || '',
      notes: p.notes || '',
      isActive: p.is_active,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }

  async function getUserByLoginId(loginId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', loginId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function generateUniqueLoginId(role, preferredId) {
    if (preferredId) {
      const clean = preferredId.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{4,20}$/.test(clean)) {
        throw new Error('User ID must be 4-20 chars using letters, numbers, underscore or hyphen');
      }
      const existing = await getUserByLoginId(clean);
      if (existing) throw new Error('This User ID is already taken');
      return clean;
    }

    const prefix = role === 'doctor' ? 'DR' : 'PT';
    const secureInt = () => {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0];
    };
    for (let i = 0; i < 15; i++) {
      const candidate = `${prefix}${String(secureInt() % 1000000).padStart(6, '0')}`;
      const existing = await getUserByLoginId(candidate);
      if (!existing) return candidate;
    }
    throw new Error('Unable to allocate a unique User ID. Please try again.');
  }

  async function register(role, name, preferredUserId, password, doctorUserId) {
    if (!name || !password) throw new Error('All required fields must be filled');
    if (password.length < 6) throw new Error('Password must be at least 6 characters');

    const loginId = await generateUniqueLoginId(role, preferredUserId);

    let doctorRow = null;
    if (role === 'patient') {
      if (!doctorUserId || doctorUserId.trim() === '') {
        throw new Error('Doctor User ID is required for patient registration');
      }
      doctorRow = await getUserByLoginId(doctorUserId.trim().toUpperCase());
      if (!doctorRow || doctorRow.role !== 'doctor') {
        throw new Error('Invalid Doctor User ID. Please verify with your doctor.');
      }
    }

    const passwordHash = await hashPassword(password);
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        user_id: loginId,
        name: name.trim(),
        role,
        password_hash: passwordHash,
        doctor_id: doctorRow ? doctorRow.id : null,
      })
      .select('*')
      .single();

    if (userError) {
      if (String(userError.message || '').toLowerCase().includes('duplicate')) {
        throw new Error('User ID already exists. Try another one.');
      }
      throw userError;
    }

    if (role === 'patient') {
      const { error: patientError } = await supabase
        .from('patients')
        .insert({
          user_id: user.id,
          doctor_id: doctorRow.id,
          name: name.trim(),
          condition: '',
          has_baseline_data: false,
        });
      if (patientError) throw patientError;
    }

    return { userId: user.id, loginId, role: user.role };
  }

  async function login(loginId, password) {
    if (!loginId || !password) throw new Error('User ID and password are required');

    const user = await getUserByLoginId(loginId.trim().toUpperCase());
    if (!user) throw new Error('No account found with this User ID');

    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.password_hash) throw new Error('Incorrect password');

    const session = {
      userId: user.id,
      loginId: user.user_id,
      role: user.role,
      name: user.name,
      doctorId: user.doctor_id || null,
      doctorCode: user.user_id,
    };

    saveSession(session);
    return session;
  }

  function logout() {
    clearSession();
    for (const channel of realtimeChannels) {
      supabase.removeChannel(channel);
    }
    realtimeChannels.clear();
  }

  async function getPatientByUserId(userId) {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return normalizePatient(data);
  }

  async function getPatientsByDoctorId(doctorId) {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('doctor_id', doctorId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizePatient);
  }

  async function updatePatientProfile(patientObj) {
    const payload = {
      id: patientObj.id,
      name: patientObj.name,
      age: patientObj.age,
      condition: patientObj.condition,
      has_baseline_data: !!patientObj.hasBaselineData,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('patients')
      .upsert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return normalizePatient(data);
  }

  async function saveThreshold(thresholdObj) {
    const now = new Date().toISOString();
    const payload = {
      patient_id: thresholdObj.patientId,
      doctor_id: thresholdObj.doctorId,
      min_angle: thresholdObj.minAngle,
      max_angle: thresholdObj.maxAngle,
      target_reps: thresholdObj.targetReps,
      motion_limit: thresholdObj.motionLimit,
      temp_limit: thresholdObj.tempLimit,
      exercise_type: thresholdObj.exerciseType,
      notes: thresholdObj.notes || '',
      updated_at: now,
    };

    const { data: existing, error: existingErr } = await supabase
      .from('thresholds')
      .select('id')
      .eq('patient_id', thresholdObj.patientId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingErr) throw existingErr;

    if (existing?.id) payload.id = existing.id;
    else payload.created_at = now;

    const { data, error } = await supabase
      .from('thresholds')
      .upsert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeThreshold(data);
  }

  async function getThresholdForPatient(patientId) {
    const { data, error } = await supabase
      .from('thresholds')
      .select('*')
      .eq('patient_id', patientId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return normalizeThreshold(data);
  }

  async function getThresholdHistoryForPatient(patientId) {
    const { data, error } = await supabase
      .from('thresholds')
      .select('*')
      .eq('patient_id', patientId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeThreshold);
  }

  async function saveExerciseRecord(record) {
    const { data, error } = await supabase
      .from('exercise_history')
      .insert({
        patient_id: record.patientId,
        doctor_id: record.doctorId,
        date: record.date || new Date().toISOString(),
        reps_completed: record.repsCompleted,
        target_reps: record.targetReps,
        max_angle_reached: record.maxAngleReached,
        min_angle_reached: record.minAngleReached,
        avg_temp: record.avgTemp,
        duration_s: record.duration_s,
        status: record.status,
        exercise_type: record.exerciseType || 'Exercise',
      })
      .select('*')
      .single();
    if (error) throw error;
    return normalizeExerciseRecord(data);
  }

  async function getExerciseHistoryForPatient(patientId) {
    const { data, error } = await supabase
      .from('exercise_history')
      .select('*')
      .eq('patient_id', patientId)
      .order('date', { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeExerciseRecord);
  }

  async function getDoctorById(doctorId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', doctorId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      userId: data.user_id,
      name: data.name,
      role: data.role,
      doctorCode: data.user_id,
      createdAt: data.created_at,
    };
  }

  async function getAllDoctors() {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'doctor')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(d => ({
      id: d.id,
      userId: d.user_id,
      name: d.name,
      role: d.role,
      doctorCode: d.user_id,
      createdAt: d.created_at,
    }));
  }

  async function saveExercisePrescription(prescriptionObj) {
    const now = new Date().toISOString();
    const payload = {
      patient_id: prescriptionObj.patientId,
      doctor_id: prescriptionObj.doctorId,
      youtube_url: prescriptionObj.youtubeUrl,
      title: prescriptionObj.title || '',
      notes: prescriptionObj.notes || '',
      is_active: prescriptionObj.isActive !== false,
      updated_at: now,
    };

    if (prescriptionObj.id) {
      payload.id = prescriptionObj.id;
    } else {
      payload.created_at = now;
    }

    const { data, error } = await supabase
      .from('exercise_prescriptions')
      .upsert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return normalizePrescription(data);
  }

  async function getExercisePrescriptionsForPatient(patientId, includeInactive = false) {
    let query = supabase
      .from('exercise_prescriptions')
      .select('*')
      .eq('patient_id', patientId)
      .order('updated_at', { ascending: false });

    if (!includeInactive) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(normalizePrescription);
  }

  async function archiveExercisePrescription(prescriptionId) {
    const { data, error } = await supabase
      .from('exercise_prescriptions')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', prescriptionId)
      .select('*')
      .single();
    if (error) throw error;
    return normalizePrescription(data);
  }

  function subscribeToPatientUpdates(patientId, callback) {
    const channel = supabase
      .channel(`patient:${patientId}:${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'thresholds', filter: `patient_id=eq.${patientId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exercise_history', filter: `patient_id=eq.${patientId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exercise_prescriptions', filter: `patient_id=eq.${patientId}` }, callback)
      .subscribe();

    realtimeChannels.add(channel);
    return () => {
      realtimeChannels.delete(channel);
      supabase.removeChannel(channel);
    };
  }

  function subscribeToDoctorUpdates(doctorId, callback) {
    const channel = supabase
      .channel(`doctor:${doctorId}:${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients', filter: `doctor_id=eq.${doctorId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'thresholds', filter: `doctor_id=eq.${doctorId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exercise_history', filter: `doctor_id=eq.${doctorId}` }, callback)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exercise_prescriptions', filter: `doctor_id=eq.${doctorId}` }, callback)
      .subscribe();

    realtimeChannels.add(channel);
    return () => {
      realtimeChannels.delete(channel);
      supabase.removeChannel(channel);
    };
  }

  // Legacy compatibility helpers
  async function _dbGet(storeName, key) {
    if (storeName === 'patients') {
      const { data, error } = await supabase.from('patients').select('*').eq('id', key).maybeSingle();
      if (error) throw error;
      return normalizePatient(data);
    }
    if (storeName === 'users') {
      const { data, error } = await supabase.from('users').select('*').eq('id', key).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { id: data.id, userId: data.user_id, name: data.name, role: data.role, doctorId: data.doctor_id || null, doctorCode: data.user_id };
    }
    return null;
  }

  async function _dbGetAll(storeName) {
    if (storeName === 'users') {
      const { data, error } = await supabase.from('users').select('*');
      if (error) throw error;
      return (data || []).map(d => ({ id: d.id, userId: d.user_id, name: d.name, role: d.role, doctorId: d.doctor_id || null, doctorCode: d.user_id }));
    }
    return [];
  }

  async function _dbGetByIndex(storeName, indexName, value) {
    if (storeName === 'patients' && indexName === 'doctorId') {
      return getPatientsByDoctorId(value);
    }
    return [];
  }

  async function _dbPut(storeName, obj) {
    if (storeName === 'patients') return updatePatientProfile(obj);
    return obj;
  }

  async function init() {
    const cfg = getConfig();
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error('Supabase client library not loaded');
    }
    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    console.log('[Auth] Supabase backend ready');
  }

  return {
    init,
    register,
    login,
    logout,
    getSession,
    hashPassword,
    generateDoctorCode: (id) => id,
    getPatientByUserId,
    getPatientsByDoctorId,
    updatePatientProfile,
    saveThreshold,
    getThresholdForPatient,
    getThresholdHistoryForPatient,
    saveExerciseRecord,
    getExerciseHistoryForPatient,
    getDoctorById,
    getAllDoctors,
    saveExercisePrescription,
    getExercisePrescriptionsForPatient,
    archiveExercisePrescription,
    subscribeToPatientUpdates,
    subscribeToDoctorUpdates,
    _dbGet,
    _dbGetAll,
    _dbGetByIndex,
    _dbPut,
  };
})();
