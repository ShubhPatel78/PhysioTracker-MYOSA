/**
 * PhysioPulse – Auth Module
 * Handles registration, login, session tokens, and all user/patient/threshold DB stores.
 * Uses Web Crypto API (SHA-256) for password hashing.
 * All data persisted in IndexedDB; session token in localStorage (8-hour expiry).
 */

const Auth = (() => {
  // ─── IndexedDB Config ─────────────────────────────────────────────────────
  const DB_NAME    = 'PhysioPulseAuth';
  const DB_VERSION = 2;
  let db = null;

  // Store names
  const STORES = {
    USERS:     'users',
    PATIENTS:  'patients',
    THRESHOLDS:'thresholds',
    EX_HISTORY:'exerciseHistory',
  };

  // ─── DB Open / Upgrade ────────────────────────────────────────────────────
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const d = e.target.result;

        // users store
        if (!d.objectStoreNames.contains(STORES.USERS)) {
          const us = d.createObjectStore(STORES.USERS, { keyPath: 'id', autoIncrement: true });
          us.createIndex('email', 'email', { unique: true });
          us.createIndex('role', 'role', { unique: false });
        }

        // patients store (doctor-created patient profiles)
        if (!d.objectStoreNames.contains(STORES.PATIENTS)) {
          const ps = d.createObjectStore(STORES.PATIENTS, { keyPath: 'id', autoIncrement: true });
          ps.createIndex('userId',   'userId',   { unique: true });   // linked user account
          ps.createIndex('doctorId', 'doctorId', { unique: false });
        }

        // thresholds store
        if (!d.objectStoreNames.contains(STORES.THRESHOLDS)) {
          const ts = d.createObjectStore(STORES.THRESHOLDS, { keyPath: 'id', autoIncrement: true });
          ts.createIndex('patientId', 'patientId', { unique: false });
          ts.createIndex('doctorId',  'doctorId',  { unique: false });
        }

        // exercise history store
        if (!d.objectStoreNames.contains(STORES.EX_HISTORY)) {
          const hs = d.createObjectStore(STORES.EX_HISTORY, { keyPath: 'id', autoIncrement: true });
          hs.createIndex('patientId', 'patientId', { unique: false });
          hs.createIndex('date',      'date',       { unique: false });
        }
      };

      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  // ─── Generic DB Helpers ───────────────────────────────────────────────────
  function dbAdd(storeName, obj) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.add(obj);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  function dbPut(storeName, obj) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(obj);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  function dbGet(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  function dbGetAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  function dbGetByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const req = index.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  function dbGetOneByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const req = index.get(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  function dbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  // ─── Password Hashing (SHA-256) ───────────────────────────────────────────
  async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'physiopulse_salt_v1');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ─── Generate Doctor Code ─────────────────────────────────────────────────
  function generateDoctorCode(userId) {
    // Short memorable code: DR + last 4 hex digits of userId hash
    return 'DR' + userId.toString().padStart(4, '0');
  }

  // ─── Session Management ───────────────────────────────────────────────────
  const SESSION_KEY = 'pp_session';
  const SESSION_EXPIRY_MS = 8 * 60 * 60 * 1000; // 8 hours

  function saveSession(session) {
    const data = { ...session, expiry: Date.now() + SESSION_EXPIRY_MS };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() > data.expiry) {
        localStorage.removeItem(SESSION_KEY);
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

  // ─── Registration ─────────────────────────────────────────────────────────
  /**
   * Register a new user.
   * @param {string} role - 'doctor' or 'patient'
   * @param {string} name
   * @param {string} email
   * @param {string} password
   * @param {string} [doctorCode] - required for patients to link to a doctor
   */
  async function register(role, name, email, password, doctorCode) {
    if (!name || !email || !password) throw new Error('All fields are required');
    if (password.length < 6) throw new Error('Password must be at least 6 characters');

    // Check email not already used
    const existing = await dbGetOneByIndex(STORES.USERS, 'email', email.toLowerCase());
    if (existing) throw new Error('An account with this email already exists');

    // For patients, verify doctor code
    let doctorId = null;
    if (role === 'patient') {
      if (!doctorCode || doctorCode.trim() === '') throw new Error('Doctor Code is required for patient registration');
      // Find doctor by code – search all doctors
      const allUsers = await dbGetAll(STORES.USERS);
      const doctors = allUsers.filter(u => u.role === 'doctor');
      const matchingDoctor = doctors.find(d => generateDoctorCode(d.id) === doctorCode.trim().toUpperCase());
      if (!matchingDoctor) throw new Error('Invalid Doctor Code. Please check with your doctor.');
      doctorId = matchingDoctor.id;
    }

    const passwordHash = await hashPassword(password);
    const user = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role,
      doctorId,
      createdAt: new Date().toISOString(),
    };

    const userId = await dbAdd(STORES.USERS, user);

    // If doctor, generate and store doctor code
    if (role === 'doctor') {
      const code = generateDoctorCode(userId);
      const storedUser = await dbGet(STORES.USERS, userId);
      storedUser.doctorCode = code;
      await dbPut(STORES.USERS, storedUser);
    }

    // If patient, create a patient profile placeholder
    if (role === 'patient') {
      await dbAdd(STORES.PATIENTS, {
        userId,
        doctorId,
        name: name.trim(),
        age: null,
        condition: '',
        createdAt: new Date().toISOString(),
        hasBaselineData: false,
      });
    }

    return { userId, role };
  }

  // ─── Login ────────────────────────────────────────────────────────────────
  async function login(email, password) {
    if (!email || !password) throw new Error('Email and password are required');

    const user = await dbGetOneByIndex(STORES.USERS, 'email', email.toLowerCase().trim());
    if (!user) throw new Error('No account found with this email');

    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.passwordHash) throw new Error('Incorrect password');

    const session = {
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      doctorId: user.doctorId || null,
      doctorCode: user.doctorCode || null,
    };
    saveSession(session);
    return session;
  }

  // ─── Logout ───────────────────────────────────────────────────────────────
  function logout() {
    clearSession();
  }

  // ─── Patient Profile CRUD ─────────────────────────────────────────────────
  async function getPatientByUserId(userId) {
    return dbGetOneByIndex(STORES.PATIENTS, 'userId', userId);
  }

  async function getPatientsByDoctorId(doctorId) {
    return dbGetByIndex(STORES.PATIENTS, 'doctorId', doctorId);
  }

  async function updatePatientProfile(patientObj) {
    return dbPut(STORES.PATIENTS, patientObj);
  }

  // ─── Threshold CRUD ───────────────────────────────────────────────────────
  /**
   * Save or update patient thresholds set by a doctor.
   */
  async function saveThreshold(thresholdObj) {
    // Check if threshold exists for patient
    const existing = await dbGetByIndex(STORES.THRESHOLDS, 'patientId', thresholdObj.patientId);
    if (existing && existing.length > 0) {
      // Update the latest one
      const latest = existing[existing.length - 1];
      const updated = { ...latest, ...thresholdObj, updatedAt: new Date().toISOString() };
      return dbPut(STORES.THRESHOLDS, updated);
    } else {
      const newThreshold = { ...thresholdObj, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      return dbAdd(STORES.THRESHOLDS, newThreshold);
    }
  }

  async function getThresholdForPatient(patientId) {
    const all = await dbGetByIndex(STORES.THRESHOLDS, 'patientId', patientId);
    if (!all || all.length === 0) return null;
    // Return the most recently updated one
    return all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
  }

  async function getThresholdHistoryForPatient(patientId) {
    const all = await dbGetByIndex(STORES.THRESHOLDS, 'patientId', patientId);
    return all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  // ─── Exercise History CRUD ────────────────────────────────────────────────
  async function saveExerciseRecord(record) {
    const obj = { ...record, date: record.date || new Date().toISOString() };
    return dbAdd(STORES.EX_HISTORY, obj);
  }

  async function getExerciseHistoryForPatient(patientId) {
    const all = await dbGetByIndex(STORES.EX_HISTORY, 'patientId', patientId);
    return all.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  // ─── Doctor Info ──────────────────────────────────────────────────────────
  async function getDoctorById(doctorId) {
    return dbGet(STORES.USERS, doctorId);
  }

  async function getAllDoctors() {
    const all = await dbGetAll(STORES.USERS);
    return all.filter(u => u.role === 'doctor');
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    await openDB();
    console.log('[Auth] IndexedDB ready');
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  return {
    init,
    register,
    login,
    logout,
    getSession,
    hashPassword,
    generateDoctorCode,
    // patient
    getPatientByUserId,
    getPatientsByDoctorId,
    updatePatientProfile,
    // thresholds
    saveThreshold,
    getThresholdForPatient,
    getThresholdHistoryForPatient,
    // exercise history
    saveExerciseRecord,
    getExerciseHistoryForPatient,
    // doctor
    getDoctorById,
    getAllDoctors,
    // db helpers (for portal modules)
    _dbGet: dbGet,
    _dbGetAll: dbGetAll,
    _dbGetByIndex: dbGetByIndex,
    _dbPut: dbPut,
  };
})();
