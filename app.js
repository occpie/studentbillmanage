/* ═══════════════════════════════════════
   PATNA YT ACADEMY – APP LOGIC (app.js)
   ═══════════════════════════════════════ */

'use strict';

/* ─── STORAGE KEYS ─── */
const STORAGE_KEY = 'patna_yt_academy_students';
const EMAIL_SETTINGS_KEY = 'patna_yt_email_settings';
const COURSES_KEY = 'patna_yt_courses';

/* ─── STATE ─── */
let students = [];
let courses = [];
let editingId = null;
let deleteTargetId = null;
let viewingId = null;
let formTouched = false;  // tracks if user typed anything in the open form
let isDataLoading = true; // true until first data fetch completes (prevents false empty-state flash)

/* ─── DOM REFS ─── */
const studentTableBody = document.getElementById('studentTableBody');
const emptyState = document.getElementById('emptyState');
const pendingCount = document.getElementById('pendingCount');
const pendingAmount = document.getElementById('pendingAmount');
const completedCount = document.getElementById('completedCount');
const completedAmount = document.getElementById('completedAmount');
const totalStudentsFooter = document.getElementById('totalStudentsFooter');
const searchInput = document.getElementById('searchInput');
const filterStatus = document.getElementById('filterStatus');
const sortBy = document.getElementById('sortBy');

/* ─── MODAL REFS ─── */
const studentModal = document.getElementById('studentModal');
const viewModal = document.getElementById('viewModal');
const confirmModal = document.getElementById('confirmModal');
const emailConfigModal = document.getElementById('emailConfigModal');
const panelOverlay = document.getElementById('panelOverlay');
const sidePanel = document.getElementById('sidePanel');
const panelTitle = document.getElementById('panelTitle');
const panelList = document.getElementById('panelList');
const modalTitle = document.getElementById('modalTitle');
const submitLabel = document.getElementById('submitLabel');
const submitSpinner = document.getElementById('submitSpinner');

/* ─── FORM REFS ─── */
const studentForm = document.getElementById('studentForm');
const studentId = document.getElementById('studentId');
const studentName = document.getElementById('studentName');
const studentPhone = document.getElementById('studentPhone');
const studentEmail = document.getElementById('studentEmail');
const admissionDate = document.getElementById('admissionDate');
const courseFee = document.getElementById('courseFee');
const paidAmount = document.getElementById('paidAmount');
const courseName = document.getElementById('courseName');
const paymentStatus = document.getElementById('paymentStatus');
const notes = document.getElementById('notes');

/* ══════════════════════════════
   UTILS
══════════════════════════════ */
function uuid() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}
function fmtCurrency(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

/* ── TOAST ── */
let toastTimer;
const toastEl = document.getElementById('toast');
function showToast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toastEl.innerHTML = `${icons[type] || ''} ${msg}`;
  toastEl.className = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

/* ── MODAL HELPERS ── */
function openModal(el) { el.classList.add('active'); }
function closeModal(el) { el.classList.remove('active'); }

/* ══════════════════════════════
   SUPABASE & AUTHENTICATION
══════════════════════════════ */
const SUPABASE_URL = 'https://spnztjgpafprtmozqbas.supabase.co';
const SUPABASE_KEY = 'sb_publishable_txUN6_JV_4IpGXut722xxg_a2f_xNLG';

// Global singleton to avoid multiple client instances contending for locks
if (!window._supaInstance) {
  window._supaInstance = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      storage: {
        getItem: (k) => window.localStorage.getItem(k),
        setItem: (k, v) => window.localStorage.setItem(k, v),
        removeItem: (k) => window.localStorage.removeItem(k)
      },
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}
const supa = window._supaInstance;
let currentUser = null;
let drafts = [];

// Convert local format to db format
function toDbFormat(s, isDraft = false) {
  return {
    id: String(s.id),
    user_id: currentUser.id,
    name: s.name,
    phone: s.phone || null,
    email: s.email || null,
    admission_date: s.admissionDate || null,
    course_fee: Number(s.courseFee) || 0,
    paid_amount: Number(s.paidAmount) || 0,
    course_name: s.courseName || null,
    payment_status: s.paymentStatus || (isDraft ? 'draft' : 'pending'),
    notes: s.notes || null,
    is_draft: isDraft,
    created_at: s.createdAt || Date.now(),
    updated_at: s.updatedAt || Date.now(),
  };
}

// Convert db format to local format
function fromDbFormat(db) {
  return {
    id: db.id,
    name: db.name,
    phone: db.phone || '',
    email: db.email || '',
    admissionDate: db.admission_date || '',
    courseFee: db.course_fee || 0,
    paidAmount: db.paid_amount || 0,
    courseName: db.course_name || '',
    paymentStatus: db.payment_status,
    notes: db.notes || '',
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    isDraft: db.is_draft
  };
}

let _fetchRetryTimer = null;

async function fetchFromSupabase(attempt = 0) {
  if (!currentUser) return;

  // Show a loading spinner in the table on first attempt
  if (attempt === 0) {
    isDataLoading = true;
    renderTable(); // shows spinner via isDataLoading flag
  }

  try {
    const { data, error } = await supa
      .from('students')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error; // go to catch for retry logic
    }

    // Success — populate arrays and render
    isDataLoading = false;
    students = data.filter(d => !d.is_draft).map(fromDbFormat);
    drafts   = data.filter(d => d.is_draft).map(fromDbFormat);
    renderTable();
    updateStats();

  } catch (err) {
    console.warn(`fetchFromSupabase attempt ${attempt + 1} failed:`, err?.message || err);

    const MAX_ATTEMPTS = 5;
    if (attempt < MAX_ATTEMPTS) {
      // Exponential backoff: 500ms, 1s, 2s, 4s, 8s
      const delay = Math.min(500 * Math.pow(2, attempt), 8000);
      console.log(`Retrying in ${delay}ms...`);
      clearTimeout(_fetchRetryTimer);
      _fetchRetryTimer = setTimeout(() => fetchFromSupabase(attempt + 1), delay);
    } else {
      // All retries exhausted
      isDataLoading = false;
      const tbody = document.getElementById('studentTableBody');
      const tbl = document.getElementById('studentTable');
      if (tbody && tbl) {
        tbl.style.display = '';
        tbody.innerHTML = `
          <tr><td colspan="10" style="text-align:center;padding:32px;color:var(--red-400);font-size:0.85rem;">
            ⚠️ Could not load data.
            <button onclick="fetchFromSupabase()" style="margin-left:8px;background:none;border:1px solid var(--red-400);color:var(--red-400);border-radius:6px;padding:4px 12px;cursor:pointer;">
              Retry
            </button>
          </td></tr>`;
      }
      showToast('Could not load data — tap Retry.', 'error');
    }
  }
}

// Re-fetch when the user comes back to the tab (e.g. switching from another app)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser && students.length === 0) {
    console.log('Tab became visible with no data — re-fetching...');
    fetchFromSupabase();
  }
});

// Re-fetch when we regain internet connection
window.addEventListener('online', () => {
  if (currentUser) {
    console.log('Network restored — re-fetching data...');
    showToast('Connection restored. Syncing data…', 'info');
    fetchFromSupabase();
  }
});

// Expose so the inline Retry button in the error row can call it
window.fetchFromSupabase = fetchFromSupabase;

async function upsertSupabase(data, isDraft = false) {
  if (!currentUser) throw new Error("Not logged in");

  // Retry logic for transient lock issues
  let retries = 2;
  while (retries >= 0) {
    try {
      const { error } = await supa.from('students').upsert(toDbFormat(data, isDraft));
      if (!error) return; // Success

      if (error.message && error.message.includes('Lock')) {
        console.warn('Sync lock conflict, retrying...', retries);
        await new Promise(r => setTimeout(r, 400));
        retries--;
        continue;
      }
      throw error;
    } catch (err) {
      if (retries === 0) throw err;
      retries--;
      await new Promise(r => setTimeout(r, 400));
    }
  }
}

async function deleteSupabase(id) {
  if (!currentUser) return;
  await supa.from('students').delete().eq('id', id);
}

const authOverlay = document.getElementById('authOverlay');
const signInBtn = document.getElementById('signInBtn');
const signUpToggleBtn = document.getElementById('signUpToggleBtn');
const doSignUpBtn = document.getElementById('doSignUpBtn');
const backToSignInBtn = document.getElementById('backToSignInBtn');
const signInActions = document.getElementById('signInActions');
const signUpFields = document.getElementById('signUpFields');
const authName = document.getElementById('authName');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authError = document.getElementById('authError');

// Global auth initialization
async function initAuth() {
  const splash = document.getElementById('authSplash');
  const card = document.getElementById('authCard');
  const overlay = document.getElementById('authOverlay');

  // 1. Listen for auth changes
  supa.auth.onAuthStateChange(async (event, session) => {
    console.log('Auth event:', event, 'Session:', !!session);
    handleAuthState(event, session);
  });

  // 2. Safety Fallback: Some browsers don't fire INITIAL_SESSION immediately
  // or the event might be missed if it fires before the listener is ready.
  try {
    const { data: { session }, error } = await supa.auth.getSession();
    if (error) throw error;
    if (session) {
      handleAuthState('INITIAL_SESSION', session);
    } else {
      // If after 1.5s we are still on the splash screen, show the login card
      setTimeout(() => {
        if (overlay && overlay.classList.contains('active') && splash && !splash.classList.contains('hidden')) {
          console.log('Safety fallback: forcing login card display');
          handleAuthState('FORCE_LOGIN_READY', null);
        }
      }, 1500);
    }
  } catch (err) {
    console.error('Initial session check failed:', err);
    handleAuthState('AUTH_ERROR', null);
  }
}

async function handleAuthState(event, session) {
  const splash = document.getElementById('authSplash');
  const card = document.getElementById('authCard');
  const overlay = document.getElementById('authOverlay');
  const signout = document.getElementById('signOutBtn');
  const userInfo = document.getElementById('userInfo');

  if (session && session.user) {
    currentUser = session.user;
    
    // Hide overlay completely
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
    
    // Show signout & user info
    if (signout) signout.classList.remove('hidden');
    if (userInfo) {
      userInfo.classList.remove('hidden');
      const meta = currentUser.user_metadata || {};
      const nameEl = document.getElementById('userNameDisplay');
      const avatarEl = document.getElementById('userAvatar');
      if (nameEl) nameEl.textContent = meta.full_name || meta.name || currentUser.email.split('@')[0];
      if (avatarEl) {
        if (meta.avatar_url) { 
          avatarEl.src = meta.avatar_url; 
          avatarEl.style.display = 'block'; 
        } else { 
          avatarEl.style.display = 'none'; 
        }
      }
    }

    // Fetch data if needed (only if students array is empty or this is a login)
    if (students.length === 0 || event === 'SIGNED_IN') {
      fetchFromSupabase();
    }
  } else {
    currentUser = null;
    
    // Show Login Card
    if (overlay) overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (splash) splash.classList.add('hidden');
    if (card) card.classList.remove('hidden');
    
    // Hide app-only elements
    if (signout) signout.classList.add('hidden');
    if (userInfo) userInfo.classList.add('hidden');

    if (event === 'SIGNED_OUT') {
      students = [];
      drafts = [];
      isDataLoading = false;
      renderTable();
      updateStats();
    }
  }
}

// Start the auth flow
initAuth();



signInBtn.addEventListener('click', async () => {
  const email = authEmail.value;
  const password = authPassword.value;
  if (!email || !password) { authError.textContent = 'Enter email and password.'; return; }
  authError.textContent = '';
  signInBtn.disabled = true;
  const { error } = await supa.auth.signInWithPassword({ email, password });
  signInBtn.disabled = false;
  if (error) authError.textContent = error.message;
});

signUpToggleBtn.addEventListener('click', () => {
  signInActions.style.display = 'none';
  signUpFields.style.display = 'block';
});
backToSignInBtn.addEventListener('click', () => {
  signInActions.style.display = 'flex';
  signUpFields.style.display = 'none';
});
doSignUpBtn.addEventListener('click', async () => {
  const email = authEmail.value;
  const password = authPassword.value;
  const name = authName.value;
  const avatarInput = document.getElementById('authAvatar');
  const avatarFile = avatarInput ? avatarInput.files[0] : null;

  if (!email || !password || !name) { authError.textContent = 'Enter name, email and password.'; return; }
  authError.textContent = '';
  doSignUpBtn.disabled = true;

  let avatar_url = null;
  if (avatarFile) {
    const fileExt = avatarFile.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

    const { data: uploadData, error: uploadError } = await supa.storage
      .from('avatars')
      .upload(fileName, avatarFile);

    if (uploadError) {
      authError.textContent = 'Error uploading image: ' + uploadError.message;
      doSignUpBtn.disabled = false;
      return;
    }

    const { data: publicUrlData } = supa.storage.from('avatars').getPublicUrl(fileName);
    avatar_url = publicUrlData.publicUrl;
  }

  const { data, error } = await supa.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
        ...(avatar_url && { avatar_url })
      }
    }
  });

  doSignUpBtn.disabled = false;

  if (error) {
    if (error.status === 429) {
      authError.textContent = 'Too many sign-up attempts. Please wait an hour or try tomorrow (Supabase free limit).';
    } else {
      authError.textContent = error.message;
    }
    authError.style.color = 'var(--red-400)';
  } else {
    authError.textContent = 'Check your email for confirmation link! You can then sign in.';
    authError.style.color = 'var(--green-400)';
    setTimeout(() => {
      signInActions.style.display = 'flex';
      signUpFields.style.display = 'none';
      authError.textContent = '';
      authError.style.color = '';
    }, 6000);
  }
});

googleSignInBtn.addEventListener('click', async () => {
  const btn = googleSignInBtn;
  const gLogo = document.getElementById('googleLogo');
  const gLoad = document.getElementById('googleLoading');
  const gLabel = document.getElementById('googleBtnLabel');

  btn.disabled = true;
  gLogo?.classList.add('hidden');
  gLoad?.classList.remove('hidden');
  if (gLabel) gLabel.textContent = 'Signing in...';

  const { error } = await supa.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });

  if (error) {
    btn.disabled = false;
    gLogo?.classList.remove('hidden');
    gLoad?.classList.add('hidden');
    if (gLabel) gLabel.textContent = 'Sign in with Google';
    authError.textContent = error.message;
  }
});

async function handleSignOut() {
  try {
    if (signOutBtn) signOutBtn.disabled = true;
    showToast('Signing out…', 'info');

    // Try graceful sign-out (may fail due to IndexedDB lock conflicts)
    await Promise.race([
      supa.auth.signOut(),
      new Promise(resolve => setTimeout(resolve, 1500)) // 1.5s timeout
    ]);
  } catch (err) {
    console.warn('signOut() threw, proceeding with manual cleanup:', err);
  } finally {
    // Manually remove ONLY the Supabase auth session keys from localStorage.
    // This works even when signOut() fails. We deliberately do NOT call
    // localStorage.clear() which would also wipe courses, email settings, etc.
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('sb-') || key.includes('supabase')) {
        localStorage.removeItem(key);
      }
    });
    // Reload to get a clean JS state — user will see login screen
    window.location.reload();
  }
}

signOutBtn.addEventListener('click', handleSignOut);
window.handleSignOut = handleSignOut;



/* Check if any significant field in the open form has been filled */
function hasMeaningfulData() {
  return (
    studentName.value.trim() !== '' ||
    studentPhone.value.trim() !== '' ||
    studentEmail.value.trim() !== '' ||
    (courseFee.value !== '' && Number(courseFee.value) !== 0) ||
    courseName.value !== '' ||
    notes.value.trim() !== ''
  );
}

/* Capture current form values into a draft object */
function captureDraft() {
  const fee = Number(courseFee.value) || 0;
  const paid = Number(paidAmount.value) || 0;
  return {
    id: editingId || uuid(),
    isDraft: true,
    name: studentName.value.trim() || '(Untitled Draft)',
    phone: studentPhone.value.trim(),
    email: studentEmail.value.trim(),
    admissionDate: admissionDate.value,
    courseFee: fee,
    paidAmount: paid,
    courseName: courseName.value.trim(),
    paymentStatus: 'draft',
    notes: notes.value.trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* Auto-save draft when modal is dismissed without submitting */
async function autoSaveDraftIfNeeded() {
  if (editingId && students.find(s => s.id === editingId)) return;
  if (!hasMeaningfulData()) return;
  const draft = captureDraft();
  const idx = drafts.findIndex(d => d.id === draft.id);
  if (idx !== -1) drafts[idx] = draft; else drafts.unshift(draft);
  await upsertSupabase(draft, true);
  renderTable();
  updateStats();
  showToast('Draft saved automatically 📝', 'info');
}

/* Manual save draft */
async function saveManualDraft() {
  if (!hasMeaningfulData()) {
    showToast('Nothing to save — fill in at least one field.', 'error');
    return;
  }
  const draft = captureDraft();
  const idx = drafts.findIndex(d => d.id === draft.id);
  if (idx !== -1) drafts[idx] = draft; else drafts.unshift(draft);

  /* Optimistic closure */
  formTouched = false;
  closeModal(studentModal);
  clearPendingDraft();
  renderTable();
  updateStats();
  showToast('Draft saved! You can resume it anytime.', 'success');

  try {
    await upsertSupabase(draft, true);
  } catch (e) {
    console.error('Background draft save failed:', e);
  }
}

/* Clear internal draft tracking after save/submit */
function clearPendingDraft() {
  formTouched = false;
}

/* Promote a draft into the edit form */
async function openDraftModal(id) {
  const draft = drafts.find(d => d.id === id);
  if (!draft) return;
  drafts = drafts.filter(d => d.id !== id);
  await deleteSupabase(id); // delete draft from db so it won't duplicate if discarded

  editingId = null;  // treat as new
  clearErrors();
  modalTitle.textContent = 'Resume Draft';
  submitLabel.textContent = 'Save Student';

  studentId.value = '';
  studentName.value = draft.name === '(Untitled Draft)' ? '' : draft.name;
  studentPhone.value = draft.phone;
  studentEmail.value = draft.email;
  admissionDate.value = draft.admissionDate || new Date().toISOString().split('T')[0];
  courseFee.value = draft.courseFee || '';
  paidAmount.value = draft.paidAmount || 0;
  populateCourseSelect(draft.courseName || '');
  notes.value = draft.notes || '';
  updateAutoStatus();
  wireAutoStatus();
  formTouched = false;
  openModal(studentModal);
  studentName.focus();
  renderTable();
  updateStats();
}

/* Delete a draft */
async function deleteDraft(id) {
  const draft = drafts.find(d => d.id === id);
  drafts = drafts.filter(d => d.id !== id);
  renderTable();
  updateStats();
  showToast(`Draft "${draft?.name || ''}" deleted.`, 'error');

  try {
    await deleteSupabase(id);
  } catch (e) {
    console.error('Background draft delete failed:', e);
  }
}

window.openDraftModal = openDraftModal;
window.deleteDraft = deleteDraft;

/* ══════════════════════════════
   EMAIL SETTINGS
══════════════════════════════ */
function getEmailSettings() {
  try { return JSON.parse(localStorage.getItem(EMAIL_SETTINGS_KEY)) || {}; }
  catch { return {}; }
}
function saveEmailSettings(s) {
  localStorage.setItem(EMAIL_SETTINGS_KEY, JSON.stringify(s));
}
function initEmailJS(settings) {
  if (settings.publicKey) {
    emailjs.init({ publicKey: settings.publicKey });
  }
}

/* Open email config */
document.getElementById('openEmailConfigBtn').addEventListener('click', () => {
  const s = getEmailSettings();
  document.getElementById('ejPublicKey').value = s.publicKey || '';
  document.getElementById('ejServiceId').value = s.serviceId || '';
  document.getElementById('ejTemplateId').value = s.templateId || '';
  openModal(emailConfigModal);
});
document.getElementById('closeEmailConfig').addEventListener('click', () => closeModal(emailConfigModal));
document.getElementById('cancelEmailConfig').addEventListener('click', () => closeModal(emailConfigModal));
document.getElementById('saveEmailConfig').addEventListener('click', () => {
  const settings = {
    publicKey: document.getElementById('ejPublicKey').value.trim(),
    serviceId: document.getElementById('ejServiceId').value.trim(),
    templateId: document.getElementById('ejTemplateId').value.trim(),
  };
  if (!settings.publicKey || !settings.serviceId || !settings.templateId) {
    showToast('Please fill all email settings fields.', 'error');
    return;
  }
  saveEmailSettings(settings);
  initEmailJS(settings);
  closeModal(emailConfigModal);
  showToast('Email settings saved!', 'success');
});

/* ══════════════════════════════
   COURSE MANAGEMENT
══════════════════════════════ */
const DEFAULT_COURSES = [
  'YouTube Pro Batch 1',
  'YouTube Pro Batch 2',
  'YouTube Pro Batch 3',
  'Short Video Mastery',
  'Channel Growth Course',
];

function loadCourses() {
  try {
    const saved = JSON.parse(localStorage.getItem(COURSES_KEY));
    courses = Array.isArray(saved) ? saved : [...DEFAULT_COURSES];
  } catch { courses = [...DEFAULT_COURSES]; }
}
function saveCourses() {
  localStorage.setItem(COURSES_KEY, JSON.stringify(courses));
}

/* Populate the <select id="courseName"> in the student form */
function populateCourseSelect(selectedValue = '') {
  const sel = document.getElementById('courseName');
  sel.innerHTML = '<option value="">— Select a course —</option>';
  courses.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === selectedValue) opt.selected = true;
    sel.appendChild(opt);
  });
}

/* Render the list inside the Manage Courses modal */
function renderCourseList() {
  const ul = document.getElementById('courseList');
  if (courses.length === 0) {
    ul.innerHTML = '<li class="course-empty">No courses yet. Add one above.</li>';
    return;
  }
  ul.innerHTML = courses.map((c, i) => {
    const count = students.filter(s => s.courseName === c).length;
    return `
      <li class="course-list-item">
        <span class="c-name">${escHtml(c)}</span>
        <span class="c-count">${count} student${count !== 1 ? 's' : ''}</span>
        <button class="course-del-btn" data-index="${i}" title="Remove course">✕</button>
      </li>`;
  }).join('');

  /* Delete handlers */
  ul.querySelectorAll('.course-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      const name = courses[idx];
      courses.splice(idx, 1);
      saveCourses();
      populateCourseSelect();
      renderCourseList();
      showToast(`"${name}" removed.`, 'info');
    });
  });
}

/* Open Manage Courses modal */
const courseModal = document.getElementById('courseModal');
const newCourseName = document.getElementById('newCourseName');

function openCourseModal() {
  newCourseName.value = '';
  renderCourseList();
  openModal(courseModal);
  newCourseName.focus();
}

document.getElementById('openCoursesBtn').addEventListener('click', openCourseModal);
document.getElementById('quickAddCourseBtn').addEventListener('click', () => {
  closeModal(studentModal);
  openCourseModal();
});
document.getElementById('closeCourseModal').addEventListener('click', () => {
  closeModal(courseModal);
  openModal(studentModal);  /* reopen student form if it was open */
});
document.getElementById('closeCourseModalFooter').addEventListener('click', () => {
  closeModal(courseModal);
});
courseModal.addEventListener('click', e => { if (e.target === courseModal) closeModal(courseModal); });

/* Add a new course */
document.getElementById('addCourseBtn').addEventListener('click', addCourse);
newCourseName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCourse(); } });

function addCourse() {
  const name = newCourseName.value.trim();
  if (!name) { showToast('Please enter a course name.', 'error'); return; }
  if (courses.some(c => c.toLowerCase() === name.toLowerCase())) {
    showToast('Course already exists!', 'error'); return;
  }
  courses.push(name);
  saveCourses();
  populateCourseSelect(name);
  newCourseName.value = '';
  renderCourseList();
  showToast(`"${name}" added!`, 'success');
}


// Generate invoice PDF matching the professional HTML template
function generateInvoiceBase64(student) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();
  const margin = 15;

  /* ── White background ── */
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pw, 297, 'F');

  /* ══════════════════════════════
     HEADER — two-column layout
  ══════════════════════════════ */
  // Left: Company info
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(17, 17, 17);
  doc.text('Patna YT Academy', margin, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('Patna, Bihar\nIndia\nEmail: hello@patnayt.com', margin, 28);

  // Right: INVOICE title + meta
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(17, 17, 17);
  doc.text('INVOICE', pw - margin, 22, { align: 'right' });

  const invoiceNo = '#' + student.id.replace(/-/g, '').slice(0, 6).toUpperCase();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text(`Invoice No: ${invoiceNo}`, pw - margin, 30, { align: 'right' });
  doc.text(`Date: ${fmtDate(new Date())}`, pw - margin, 35, { align: 'right' });
  doc.text('Due: Upon Receipt', pw - margin, 40, { align: 'right' });

  /* ── Horizontal rule under header ── */
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.4);
  doc.line(margin, 48, pw - margin, 48);

  /* ══════════════════════════════
     BILL TO section
  ══════════════════════════════ */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(17, 17, 17);
  doc.text('Bill To:', margin, 57);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(student.name, margin, 63);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  if (student.phone) doc.text(student.phone, margin, 69);
  if (student.email) doc.text(student.email, margin, 74);
  if (student.courseName) doc.text(student.courseName, margin, 79);

  /* ══════════════════════════════
     ITEM TABLE
  ══════════════════════════════ */
  const tableTop = 90;

  // Black header row
  doc.setFillColor(17, 17, 17);
  doc.rect(margin, tableTop, pw - margin * 2, 9, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('Item', margin + 3, tableTop + 6);
  doc.text('Description', margin + 22, tableTop + 6);
  doc.text('Paid', pw - 55, tableTop + 6, { align: 'right' });
  doc.text('Total', pw - margin - 2, tableTop + 6, { align: 'right' });

  // White item row
  const rowY = tableTop + 9;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  doc.text('1', margin + 3, rowY + 6);
  doc.text(student.courseName || 'Course Enrollment', margin + 22, rowY + 6);
  doc.text(fmtCurrency(student.paidAmount), pw - 55, rowY + 6, { align: 'right' });
  doc.text(fmtCurrency(student.courseFee), pw - margin - 2, rowY + 6, { align: 'right' });

  // Bottom border on row
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.4);
  doc.line(margin, rowY + 10, pw - margin, rowY + 10);

  /* ══════════════════════════════
     TOTALS BOX (right-aligned)
  ══════════════════════════════ */
  const due = Math.max(0, (student.courseFee || 0) - (student.paidAmount || 0));
  const boxX = pw - margin - 80;
  const boxW = 80;
  let ty = rowY + 20;

  // Subtotal row
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text('Subtotal', boxX, ty);
  doc.setTextColor(17, 17, 17);
  doc.text(fmtCurrency(student.courseFee), boxX + boxW, ty, { align: 'right' });
  ty += 7;

  // Amount Paid row
  doc.setTextColor(60, 60, 60);
  doc.text('Amount Paid', boxX, ty);
  doc.setTextColor(17, 17, 17);
  doc.text(fmtCurrency(student.paidAmount), boxX + boxW, ty, { align: 'right' });
  ty += 5;

  // Divider above Due
  doc.setDrawColor(180, 180, 180);
  doc.line(boxX, ty, boxX + boxW, ty);
  ty += 6;

  // Due row — bold, larger
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(17, 17, 17);
  doc.text('Due', boxX, ty);
  doc.text(fmtCurrency(due), boxX + boxW, ty, { align: 'right' });

  /* ══════════════════════════════
     NOTES (if any)
  ══════════════════════════════ */
  if (student.notes) {
    const notesY = ty + 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(17, 17, 17);
    doc.text('Notes:', margin, notesY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(student.notes, pw - margin * 2);
    doc.text(lines, margin, notesY + 6);
  }

  /* ══════════════════════════════
     FOOTER
  ══════════════════════════════ */
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, 268, pw - margin, 268);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text('Thank you for your business!', pw / 2, 276, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Patna YT Academy · Patna, Bihar, India · hello@patnayt.com', pw / 2, 282, { align: 'center' });

  return doc.output('datauristring');
}

function downloadSinglePdf(id) {
  const student = students.find(s => s.id === id);
  if (!student) return;

  const dataUri = generateInvoiceBase64(student);

  // Create a temporary link and trigger download
  const link = document.createElement('a');
  link.href = dataUri;
  link.download = `Invoice_${student.name.replace(/\s+/g, '_')}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast(`Invoice for ${student.name} downloaded!`, 'success');
}


async function sendBillingEmail(student, pdfDataUri) {
  const settings = getEmailSettings();
  if (!settings.serviceId || !settings.templateId || !settings.publicKey) {
    showToast('Email not configured. Go to ⚙️ Email Settings.', 'info');
    return false;
  }
  const due = (Number(student.courseFee) || 0) - (Number(student.paidAmount) || 0);
  const params = {
    to_name: student.name,
    to_email: student.email,
    from_name: 'Patna YT Academy',
    student_phone: student.phone,
    admission_date: fmtDate(student.admissionDate),
    course_name: student.courseName || 'YouTube Course',
    course_fee: fmtCurrency(student.courseFee),
    paid_amount: fmtCurrency(student.paidAmount),
    pending_amount: fmtCurrency(due),
    payment_status: student.paymentStatus.charAt(0).toUpperCase() + student.paymentStatus.slice(1),
    notes: student.notes || '—',
    academy_name: 'Patna YT Academy',
    content: pdfDataUri,
  };
  try {
    await emailjs.send(settings.serviceId, settings.templateId, params);
    return true;
  } catch (err) {
    console.error('EmailJS error:', err);
    return false;
  }
}

/* ══════════════════════════════
   FORM VALIDATION
══════════════════════════════ */
function clearErrors() {
  document.querySelectorAll('.field-err').forEach(e => e.textContent = '');
  document.querySelectorAll('.form-group input').forEach(i => i.classList.remove('error'));
}
function setError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
  const input = el?.id.replace('err-', '');
}
function validateForm() {
  clearErrors();
  let valid = true;
  const nameVal = studentName.value.trim();
  const phoneVal = studentPhone.value.trim();
  const emailVal = studentEmail.value.trim();
  const feeVal = courseFee.value;

  if (!nameVal) {
    document.getElementById('err-name').textContent = 'Name is required.';
    studentName.classList.add('error'); valid = false;
  }
  if (!phoneVal || !/^\d{10}$/.test(phoneVal)) {
    document.getElementById('err-phone').textContent = 'Enter a valid 10-digit phone number.';
    studentPhone.classList.add('error'); valid = false;
  }
  if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
    document.getElementById('err-email').textContent = 'Enter a valid email address.';
    studentEmail.classList.add('error'); valid = false;
  }
  if (feeVal === '' || Number(feeVal) < 0) {
    document.getElementById('err-fee').textContent = 'Enter a valid course fee.';
    courseFee.classList.add('error'); valid = false;
  }

  if (!valid) {
    showToast('Please fix the errors in the form.', 'error');
  }
  return valid;
}

/* ══════════════════════════════
   ADD / EDIT STUDENT FORM
══════════════════════════════ */
/* ── AUTO STATUS UPDATER ── */
function updateAutoStatus() {
  const fee = Number(courseFee.value) || 0;
  const paid = Number(paidAmount.value) || 0;
  const badge = document.getElementById('statusAutoBadge');
  const hint = document.getElementById('statusAutoHint');
  const hiddenStatus = document.getElementById('paymentStatus');

  if (!fee) {
    badge.className = 'status-pill status-pending';
    badge.innerHTML = '<span class="status-dot"></span> Pending';
    hint.textContent = 'Enter course fee above';
    hiddenStatus.value = 'pending';
    return;
  }
  const due = fee - paid;
  if (paid >= fee) {
    badge.className = 'status-pill status-completed';
    badge.innerHTML = '<span class="status-dot"></span> Completed';
    hint.textContent = 'Full fee paid — cleared!';
    hiddenStatus.value = 'completed';
  } else if (paid > 0) {
    badge.className = 'status-pill status-partial';
    badge.innerHTML = '<span class="status-dot"></span> Partial';
    hint.textContent = `${fmtCurrency(due)} still pending`;
    hiddenStatus.value = 'partial';
  } else {
    badge.className = 'status-pill status-pending';
    badge.innerHTML = '<span class="status-dot"></span> Pending';
    hint.textContent = `Full ${fmtCurrency(fee)} pending`;
    hiddenStatus.value = 'pending';
  }
}

function wireAutoStatus() {
  /* We use a flag to only wire once to prevent duplicate listeners */
  if (window._autoStatusWired) return;
  courseFee.addEventListener('input', updateAutoStatus);
  paidAmount.addEventListener('input', updateAutoStatus);
  window._autoStatusWired = true;
}

document.getElementById('openAddStudentBtn').addEventListener('click', () => openAddModal());

function openAddModal() {
  editingId = null;
  studentForm.reset();
  clearErrors();

  /* Reset Submit Button UI */
  submitLabel.classList.remove('hidden');
  submitSpinner.classList.add('hidden');
  document.getElementById('submitBtn').disabled = false;

  /* Auto-set today */
  admissionDate.value = new Date().toISOString().split('T')[0];
  paidAmount.value = '0';
  modalTitle.textContent = 'Add Student';
  submitLabel.textContent = 'Add Student';
  populateCourseSelect();
  updateAutoStatus();
  wireAutoStatus();
  openModal(studentModal);
  studentName.focus();
}

function openEditModal(id) {
  const student = students.find(s => s.id === id);
  if (!student) return;
  editingId = id;
  clearErrors();

  /* Reset Submit Button UI */
  submitLabel.classList.remove('hidden');
  submitSpinner.classList.add('hidden');
  document.getElementById('submitBtn').disabled = false;

  modalTitle.textContent = 'Edit Student';
  submitLabel.textContent = 'Save Changes';

  studentId.value = student.id;
  studentName.value = student.name;
  studentPhone.value = student.phone;
  studentEmail.value = student.email;
  admissionDate.value = student.admissionDate;
  courseFee.value = student.courseFee;
  paidAmount.value = student.paidAmount || 0;
  populateCourseSelect(student.courseName || '');
  notes.value = student.notes || '';
  updateAutoStatus();
  wireAutoStatus();

  openModal(studentModal);
  studentName.focus();
}

document.getElementById('closeModal').addEventListener('click', () => {
  autoSaveDraftIfNeeded();
  clearPendingDraft();
  closeModal(studentModal);
});
document.getElementById('cancelFormBtn').addEventListener('click', () => {
  autoSaveDraftIfNeeded();
  clearPendingDraft();
  closeModal(studentModal);
});
studentModal.addEventListener('click', e => {
  if (e.target === studentModal) {
    autoSaveDraftIfNeeded();
    clearPendingDraft();
    closeModal(studentModal);
  }
});

/* Manual draft save button */
document.getElementById('saveDraftBtn').addEventListener('click', saveManualDraft);

studentForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Triggers visual feedback immediately
  if (!validateForm()) return;

  const isNew = !editingId;
  const currentEditingId = editingId;
  const fee = Number(courseFee.value) || 0;
  const paid = Number(paidAmount.value) || 0;
  const due = fee - paid;
  let auto_status = paymentStatus.value;
  if (due <= 0 && fee > 0) auto_status = 'completed';
  else if (paid > 0 && due > 0) auto_status = 'partial';

  const studentData = {
    id: isNew ? uuid() : currentEditingId,
    name: studentName.value.trim(),
    phone: studentPhone.value.trim(),
    email: studentEmail.value.trim(),
    admissionDate: admissionDate.value,
    courseFee: fee,
    paidAmount: paid,
    courseName: courseName.value.trim(),
    paymentStatus: auto_status,
    notes: notes.value.trim(),
    createdAt: isNew ? Date.now() : (students.find(s => s.id === currentEditingId)?.createdAt || Date.now()),
    updatedAt: Date.now(),
  };

  /* 1. Show Loading UI Briefly */
  submitLabel.classList.add('hidden');
  submitSpinner.classList.remove('hidden');
  document.getElementById('submitBtn').disabled = true;

  /* 2. Optimistic UI Update & Immediate Feedback */
  // Use a tiny timeout to let the spinner show for a split second (feels more responsive)
  setTimeout(() => {
    closeModal(studentModal);

    if (isNew) {
      students.unshift(studentData);
    } else {
      const idx = students.findIndex(s => s.id === currentEditingId);
      if (idx !== -1) students[idx] = studentData;
    }

    /* Clear local draft tracking */
    if (isNew) {
      drafts = drafts.filter(d => d.id !== studentData.id);
    }
    clearPendingDraft();
    renderTable();
    updateStats();

    /* 3. Background Sync & Tasks (Sequential to avoid lock conflicts) */
    (async () => {
      try {
        // A) Sync Data with Supabase
        await upsertSupabase(studentData, false);

        // B) Record is now in Supabase (upsert handled promotion if it was a draft)
        // No additional cleanup needed as the record is already updated.

        // C) Communications (Email/PDF)
        let emailSent = false;
        if (isNew) {
          try {
            const b64Pdf = generateInvoiceBase64(studentData);
            emailSent = await sendBillingEmail(studentData, b64Pdf);
          } catch (e) {
            console.error("PDF generation/email error:", e);
            emailSent = await sendBillingEmail(studentData, null).catch(() => false);
          }
        }

        showToast(
          isNew
            ? (emailSent ? `${studentData.name} added & email sent! 🎉` : `${studentData.name} added successfully!`)
            : `${studentData.name}'s details updated!`,
          'success'
        );

      } catch (err) {
        console.error('Failed to sync student with server:', err);
        showToast('Server sync failed. Your changes might be lost on refresh.', 'error');
        // Critical: refresh to show actual server state
        fetchFromSupabase();
      }
    })();
  }, 100);
});

/* ══════════════════════════════
   DELETE STUDENT
══════════════════════════════ */
function openDeleteModal(id) {
  const student = students.find(s => s.id === id);
  if (!student) return;
  deleteTargetId = id;
  document.getElementById('confirmMsg').textContent =
    `Are you sure you want to delete ${student.name}? This cannot be undone.`;
  openModal(confirmModal);
}

document.getElementById('confirmCancelBtn').addEventListener('click', () => {
  deleteTargetId = null;
  closeModal(confirmModal);
});
document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if (!deleteTargetId) return;
  const student = students.find(s => s.id === deleteTargetId);
  const targetId = deleteTargetId;

  /* Optimistic update */
  students = students.filter(s => s.id !== targetId);
  renderTable();
  updateStats();
  closeModal(confirmModal);
  deleteTargetId = null;

  try {
    await deleteSupabase(targetId);
    showToast(`${student?.name || 'Student'} deleted.`, 'error');
  } catch (e) {
    showToast('Failed to delete student.', 'error');
    console.error(e);
    // Silent rollback if needed, but usually Supabase errors are rare here
    fetchFromSupabase();
  }
});
confirmModal.addEventListener('click', e => { if (e.target === confirmModal) closeModal(confirmModal); });

/* ══════════════════════════════
   VIEW STUDENT
══════════════════════════════ */
function openViewModal(id) {
  const student = students.find(s => s.id === id);
  if (!student) return;
  viewingId = id;
  const due = (student.courseFee || 0) - (student.paidAmount || 0);

  const statusMap = {
    pending: '<span class="status-pill status-pending"><span class="status-dot"></span>Pending</span>',
    partial: '<span class="status-pill status-partial"><span class="status-dot"></span>Partial</span>',
    completed: '<span class="status-pill status-completed"><span class="status-dot"></span>Completed</span>',
  };

  document.getElementById('viewContent').innerHTML = `
    <div class="view-student-header">
      <div class="view-avatar">${getInitials(student.name)}</div>
      <div>
        <h3>${escHtml(student.name)}</h3>
        <p>${escHtml(student.email)}</p>
      </div>
    </div>
    <div class="view-detail-grid">
      <div class="view-detail-item">
        <span class="vd-label">Phone</span>
        <span class="vd-value">📞 ${escHtml(student.phone)}</span>
      </div>
      <div class="view-detail-item">
        <span class="vd-label">Admission Date</span>
        <span class="vd-value">📅 ${fmtDate(student.admissionDate)}</span>
      </div>
      <div class="view-detail-item">
        <span class="vd-label">Course / Batch</span>
        <span class="vd-value">🎬 ${escHtml(student.courseName || '—')}</span>
      </div>
      <div class="view-detail-item">
        <span class="vd-label">Payment Status</span>
        <span class="vd-value">${statusMap[student.paymentStatus] || '—'}</span>
      </div>
      <div class="view-detail-item">
        <span class="vd-label">Course Fee</span>
        <span class="vd-value" style="color:var(--text-primary)">${fmtCurrency(student.courseFee)}</span>
      </div>
      <div class="view-detail-item">
        <span class="vd-label">Amount Paid</span>
        <span class="vd-value" style="color:var(--green-400)">${fmtCurrency(student.paidAmount)}</span>
      </div>
      <div class="view-detail-item">
        <span class="vd-label">Amount Due</span>
        <span class="vd-value" style="color:${due > 0 ? 'var(--orange-400)' : 'var(--green-400)'}">${fmtCurrency(due)}</span>
      </div>
      <div class="view-detail-item">
        <span class="vd-label">Added On</span>
        <span class="vd-value">${fmtDate(new Date(student.createdAt).toISOString().split('T')[0])}</span>
      </div>
      ${student.notes ? `
      <div class="view-detail-item" style="grid-column:1/-1">
        <span class="vd-label">Notes</span>
        <span class="vd-value">${escHtml(student.notes)}</span>
      </div>` : ''}
    </div>
  `;

  openModal(viewModal);
}

document.getElementById('closeViewModal').addEventListener('click', () => closeModal(viewModal));
viewModal.addEventListener('click', e => { if (e.target === viewModal) closeModal(viewModal); });
document.getElementById('viewEditBtn').addEventListener('click', () => {
  closeModal(viewModal);
  if (viewingId) openEditModal(viewingId);
});
document.getElementById('viewDownloadBtn').addEventListener('click', () => {
  if (viewingId) downloadSinglePdf(viewingId);
});

/* ══════════════════════════════
   SIDE PANEL (pending / completed list)
══════════════════════════════ */
function openPanel(type) {
  const isPending = type === 'pending';
  panelTitle.textContent = isPending ? 'Pending Payments' : 'Completed Payments';

  const filtered = students.filter(s =>
    isPending ? (s.paymentStatus !== 'completed') : (s.paymentStatus === 'completed')
  );

  if (filtered.length === 0) {
    panelList.innerHTML = `<div class="empty-state"><div class="empty-icon">${isPending ? '✅' : '💸'}</div>
      <h3>${isPending ? 'No pending payments!' : 'No completed payments yet'}</h3></div>`;
  } else {
    panelList.innerHTML = filtered.map(s => {
      const due = (s.courseFee || 0) - (s.paidAmount || 0);
      return `
        <div class="panel-item" data-id="${s.id}">
          <div>
            <div class="panel-item-name">${escHtml(s.name)}</div>
            <div class="panel-item-sub">📞 ${escHtml(s.phone)} &nbsp;|&nbsp; ${fmtDate(s.admissionDate)}</div>
          </div>
          <div class="panel-item-due" style="color:${isPending ? 'var(--orange-400)' : 'var(--green-400)'}">
            ${isPending ? fmtCurrency(due) + ' due' : '✓ Paid'}
          </div>
        </div>`;
    }).join('');
  }

  openModal(panelOverlay);
}

document.getElementById('pendingArrowBtn').addEventListener('click', () => openPanel('pending'));
document.getElementById('completedArrowBtn').addEventListener('click', () => openPanel('completed'));
document.getElementById('closePanelBtn').addEventListener('click', () => closeModal(panelOverlay));
panelOverlay.addEventListener('click', e => {
  if (!sidePanel.contains(e.target)) closeModal(panelOverlay);
});

/* Draft panel */
document.getElementById('draftArrowBtn').addEventListener('click', () => {
  panelTitle.textContent = 'Draft Entries';
  if (drafts.length === 0) {
    panelList.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><h3>No drafts yet</h3><p>Half-filled forms are auto-saved here.</p></div>`;
  } else {
    panelList.innerHTML = drafts.map(d => `
      <div class="panel-item" style="cursor:pointer" onclick="openDraftModal('${d.id}'); closeModal(panelOverlay);">
        <div>
          <div class="panel-item-name">${escHtml(d.name)}</div>
          <div class="panel-item-sub">${d.phone ? '📞 ' + escHtml(d.phone) : 'No phone'} &nbsp;|&nbsp; ${d.courseName ? escHtml(d.courseName) : 'No course'}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="status-pill status-draft" style="font-size:0.7rem">📝 Draft</span>
          <button class="tbl-btn tbl-btn--delete" onclick="event.stopPropagation();deleteDraft('${d.id}');renderTable();updateStats();if(drafts.length===0)closeModal(panelOverlay);" title="Delete Draft">🗑</button>
        </div>
      </div>`).join('');
  }
  openModal(panelOverlay);
});

/* ══════════════════════════════
   XSS PROTECTION
══════════════════════════════ */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, s => ESC_MAP[s]);
}

/* ══════════════════════════════
   STATS UPDATE  (with pop animation)
══════════════════════════════ */
function animatePop(el) {
  if (!el) return;
  // Use double-rAF for reliable animation restart without triggering reflow
  requestAnimationFrame(() => {
    el.classList.remove('pop');
    requestAnimationFrame(() => el.classList.add('pop'));
  });
}

function updateStats() {
  const pending = students.filter(s => s.paymentStatus !== 'completed');
  const completed = students.filter(s => s.paymentStatus === 'completed');
  const totalDue = pending.reduce((acc, s) =>
    acc + Math.max(0, (s.courseFee || 0) - (s.paidAmount || 0)), 0);
  const totalCompletedCollected = completed.reduce((acc, s) =>
    acc + (s.courseFee || 0), 0);
  /* Total collected = sum of paidAmount across ALL students */
  const totalAllPaid = students.reduce((acc, s) =>
    acc + (Number(s.paidAmount) || 0), 0);

  // Batch DOM reads first, then writes (avoids layout thrash)
  const newPending = pending.length;
  const newCompleted = completed.length;
  const collectedText = fmtCurrency(totalAllPaid);
  const draftCount = drafts.length;

  pendingCount.textContent = newPending;
  pendingAmount.textContent = `${fmtCurrency(totalDue)} due`;
  completedCount.textContent = newCompleted;
  completedAmount.textContent = `${fmtCurrency(totalCompletedCollected)} collected`;
  document.getElementById('collectedCount').textContent = collectedText;
  document.getElementById('collectedSub').textContent =
    `from ${students.length} student${students.length !== 1 ? 's' : ''}`;
  totalStudentsFooter.textContent = `${students.length} student${students.length !== 1 ? 's' : ''} enrolled`;

  /* Drafts count */
  const draftCountEl = document.getElementById('draftCount');
  draftCountEl.textContent = draftCount;
  document.getElementById('draftSub').textContent = draftCount === 1 ? '1 incomplete entry' : `${draftCount} incomplete entries`;
  document.getElementById('draftCard').style.opacity = draftCount > 0 ? '1' : '0.5';

  // Trigger pop animations after writes
  animatePop(pendingCount);
  animatePop(completedCount);
  animatePop(document.getElementById('collectedCount'));
  animatePop(draftCountEl);
}

/* ══════════════════════════════
   RENDER TABLE
══════════════════════════════ */
function getFilteredSortedStudents() {
  const query = searchInput.value.toLowerCase().trim();
  const status = filterStatus.value;
  const sort = sortBy.value;

  let list = students.filter(s => {
    const matchSearch = !query ||
      s.name.toLowerCase().includes(query) ||
      s.email.toLowerCase().includes(query) ||
      s.phone.includes(query) ||
      (s.courseName || '').toLowerCase().includes(query);
    const matchStatus = status === 'all' || s.paymentStatus === status;
    return matchSearch && matchStatus;
  });

  list.sort((a, b) => {
    switch (sort) {
      case 'date-desc': return b.createdAt - a.createdAt;
      case 'date-asc': return a.createdAt - b.createdAt;
      case 'name-asc': return a.name.localeCompare(b.name);
      case 'name-desc': return b.name.localeCompare(a.name);
      case 'due-desc': {
        const dA = (a.courseFee || 0) - (a.paidAmount || 0);
        const dB = (b.courseFee || 0) - (b.paidAmount || 0);
        return dB - dA;
      }
      default: return 0;
    }
  });

  return list;
}

function statusPill(status) {
  const map = {
    pending: `<span class="status-pill status-pending"><span class="status-dot"></span>Pending</span>`,
    partial: `<span class="status-pill status-partial"><span class="status-dot"></span>Partial</span>`,
    completed: `<span class="status-pill status-completed"><span class="status-dot"></span>Completed</span>`,
    draft: `<span class="status-pill status-draft"><span class="status-dot"></span>Draft</span>`,
  };
  return map[status] || `<span class="status-pill">${status}</span>`;
}

function renderTable() {
  const list = getFilteredSortedStudents();
  const tbody = studentTableBody;
  const filterVal = filterStatus.value;
  const studentTable = document.getElementById('studentTable');

  /* Build combined list: real students + drafts (when filter is 'all' or 'draft') */
  let draftRowsCount = 0;
  let draftHtml = '';

  if (filterVal === 'all' || filterVal === 'draft') {
    const query = searchInput.value.toLowerCase().trim();
    const filteredDrafts = drafts.filter(d => {
      if (!query) return true;
      return (
        d.name.toLowerCase().includes(query) ||
        d.email.toLowerCase().includes(query) ||
        d.phone.includes(query) ||
        (d.courseName || '').toLowerCase().includes(query)
      );
    });
    draftRowsCount = filteredDrafts.length;
    draftHtml = filteredDrafts.map((d, idx) => `
      <tr class="draft-row">
        <td class="student-num">D${idx + 1}</td>
        <td class="td-name-actions">
          <div class="mob-name-row">
            <div class="student-name-cell">
              <div class="name">${escHtml(d.name)} <span class="draft-badge">📝 Draft</span></div>
              <div class="email">${d.email ? escHtml(d.email) : '<em style="color:var(--text-muted)">No email yet</em>'}</div>
            </div>
            <div class="mob-action-icons">
               <button class="mob-icon-btn mob-icon--edit" onclick="openDraftModal('${d.id}')" title="Resume Draft">✏️ <span class="mob-btn-label">Resume</span></button>
               <button class="mob-icon-btn mob-icon--del" onclick="deleteDraft('${d.id}')" title="Delete Draft">🗑</button>
            </div>
          </div>
        </td>
        <td class="student-phone">${d.phone ? escHtml(d.phone) : '—'}</td>
        <td class="student-course">${d.courseName ? escHtml(d.courseName) : '—'}</td>
        <td class="student-date">${fmtDate(d.admissionDate)}</td>
        <td class="amount-cell amount-fee">${d.courseFee ? fmtCurrency(d.courseFee) : '—'}</td>
        <td class="amount-cell">—</td>
        <td class="amount-cell">—</td>
        <td>${statusPill('draft')}</td>
        <td>
          <div class="action-btns">
            <button class="tbl-btn tbl-btn--edit" onclick="openDraftModal('${d.id}')" title="Resume Draft">✏️</button>
            <button class="tbl-btn tbl-btn--delete" onclick="deleteDraft('${d.id}')" title="Delete Draft">🗑</button>
          </div>
        </td>
      </tr>`).join('');
  }

  /* If only showing drafts, hide real students */
  const displayList = filterVal === 'draft' ? [] : list;

  if (displayList.length === 0 && draftRowsCount === 0) {
    if (isDataLoading) {
      // Show spinner while auth/data is loading — never show empty state prematurely
      emptyState.classList.add('hidden');
      studentTable.style.display = '';
      tbody.innerHTML = `
        <tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted);font-size:0.85rem;">
          <div class="spinner" style="margin:0 auto 12px;width:28px;height:28px;"></div>
          Loading your data…
        </td></tr>`;
    } else {
      tbody.innerHTML = '';
      emptyState.classList.remove('hidden');
      studentTable.style.display = 'none';
    }
  } else {
    emptyState.classList.add('hidden');
    studentTable.style.display = '';

    const studentHtml = displayList.map((s, idx) => {
      const due = Math.max(0, (s.courseFee || 0) - (s.paidAmount || 0));
      return `
        <tr>
          <td class="student-num">${idx + 1}</td>
          <td class="td-name-actions">
            <div class="mob-name-row">
              <div class="student-name-cell">
                <div class="name">${escHtml(s.name)}</div>
                <div class="email">${escHtml(s.email)}</div>
              </div>
              <div class="mob-action-icons">
                <button class="mob-icon-btn mob-icon--view" onclick="openViewModal('${s.id}')" title="View More">👁 <span class="mob-btn-label">View</span></button>
                <button class="mob-icon-btn mob-icon--pdf" onclick="downloadSinglePdf('${s.id}')" title="Download PDF">📥 <span class="mob-btn-label">PDF</span></button>
                <button class="mob-icon-btn mob-icon--edit" onclick="openEditModal('${s.id}')" title="Edit">✏️</button>
                <button class="mob-icon-btn mob-icon--del" onclick="openDeleteModal('${s.id}')" title="Delete">🗑</button>
              </div>
            </div>
          </td>
          <td class="student-phone">${escHtml(s.phone)}</td>
          <td class="student-course" title="${escHtml(s.courseName || '')}">
            ${escHtml(s.courseName || '—')}
          </td>
          <td class="student-date">${fmtDate(s.admissionDate)}</td>
          <td class="amount-cell amount-fee" data-label="Fee">${fmtCurrency(s.courseFee)}</td>
          <td class="amount-cell amount-paid" data-label="Paid">${fmtCurrency(s.paidAmount)}</td>
          <td class="amount-cell amount-due ${due === 0 ? 'zero' : ''}" data-label="Due">${fmtCurrency(due)}</td>
          <td>${statusPill(s.paymentStatus)}</td>
          <td>
            <div class="action-btns">
              <button class="tbl-btn tbl-btn--view" onclick="openViewModal('${s.id}')" title="View Details">👁</button>
              <button class="tbl-btn tbl-btn--download" onclick="downloadSinglePdf('${s.id}')" title="Download Invoice">📥</button>
              <button class="tbl-btn tbl-btn--edit" onclick="openEditModal('${s.id}')" title="Edit">✏️</button>
              <button class="tbl-btn tbl-btn--delete" onclick="openDeleteModal('${s.id}')" title="Delete">🗑</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    tbody.innerHTML = studentHtml + draftHtml;
  }
}

/* ══════════════════════════════
   SEARCH / FILTER / SORT
══════════════════════════════ */
// Debounce search input to avoid re-rendering on every keystroke
let _searchDebounceTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(_searchDebounceTimer);
  _searchDebounceTimer = setTimeout(renderTable, 120);
});
filterStatus.addEventListener('change', renderTable);
sortBy.addEventListener('change', renderTable);

/* ══════════════════════════════
   PDF DOWNLOAD
══════════════════════════════ */
document.getElementById('downloadPdfBtn').addEventListener('click', downloadPDF);

function downloadPDF() {
  if (students.length === 0) {
    showToast('No students to export!', 'error');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 16;
  let y = margin;

  /* ── Header ── */
  doc.setFillColor(109, 40, 217);
  doc.rect(0, 0, pageW, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('Patna YT Academy', margin, 14);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Student Billing Report', pageW - margin, 14, { align: 'right' });
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    pageW - margin, 19, { align: 'right' });
  y = 32;

  /* ── Summary Row ── */
  const totalPaid = students.reduce((a, s) => a + (Number(s.paidAmount) || 0), 0);
  const totalDue = students.reduce((a, s) => a + Math.max(0, (s.courseFee || 0) - (s.paidAmount || 0)), 0);
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 100);
  doc.setFont('helvetica', 'normal');
  doc.text(`Total Students: ${students.length}`, margin, y);
  doc.text(`Total Collected: ${fmtCurrency(totalPaid)}`, margin + 55, y);
  doc.text(`Total Pending: ${fmtCurrency(totalDue)}`, margin + 120, y);
  y += 8;

  /* ── Divider ── */
  doc.setDrawColor(200, 190, 240);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  /* ── Table header ── */
  const cols = [
    { label: '#', w: 8 },
    { label: 'Name', w: 45 },
    { label: 'Phone', w: 28 },
    { label: 'Course', w: 40 },
    { label: 'Admitted', w: 22 },
    { label: 'Fee', w: 18 },
    { label: 'Paid', w: 18 },
    { label: 'Due', w: 18 },
  ];

  doc.setFillColor(240, 235, 255);
  doc.rect(margin, y, pageW - margin * 2, 8, 'F');
  doc.setTextColor(60, 20, 140);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  let cx = margin + 2;
  cols.forEach(col => {
    doc.text(col.label, cx, y + 5.5);
    cx += col.w;
  });
  y += 9;

  /* ── Table rows ── */
  const list = getFilteredSortedStudents();
  list.forEach((s, i) => {
    if (y > 270) {
      doc.addPage();
      y = margin;
    }
    const due = Math.max(0, (s.courseFee || 0) - (s.paidAmount || 0));
    const isEven = i % 2 === 0;
    if (isEven) {
      doc.setFillColor(250, 248, 255);
      doc.rect(margin, y, pageW - margin * 2, 7.5, 'F');
    }
    doc.setTextColor(30, 30, 50);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const row = [
      String(i + 1),
      s.name,
      s.phone,
      (s.courseName || '—').slice(0, 20),
      fmtDate(s.admissionDate),
      fmtCurrency(s.courseFee),
      fmtCurrency(s.paidAmount),
      fmtCurrency(due),
    ];
    cx = margin + 2;
    /* colour due amount */
    row.forEach((val, ci) => {
      if (ci === 7 && due > 0) doc.setTextColor(200, 80, 0);
      else if (ci === 6) doc.setTextColor(0, 130, 80);
      else doc.setTextColor(30, 30, 50);
      doc.text(String(val).slice(0, 18), cx, y + 5);
      cx += cols[ci].w;
    });
    /* status indicator dot */
    const dotColor = s.paymentStatus === 'completed' ? [0, 180, 100] :
      s.paymentStatus === 'partial' ? [120, 80, 200] : [220, 100, 0];
    doc.setFillColor(...dotColor);
    doc.circle(pageW - margin - 3, y + 3.5, 2, 'F');
    y += 7.5;

    /* Row border */
    doc.setDrawColor(230, 225, 245);
    doc.line(margin, y, pageW - margin, y);
  });

  /* ── Footer ── */
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(150, 140, 170);
    doc.text(`Patna YT Academy — Confidential`, margin, 290);
    doc.text(`Page ${p} of ${pageCount}`, pageW - margin, 290, { align: 'right' });
  }

  const filename = `PatnaYT_Billing_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
  showToast('PDF downloaded successfully! 📄', 'success');
}

/* Keyboard shortcuts */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal(studentModal);
    closeModal(viewModal);
    closeModal(confirmModal);
    closeModal(emailConfigModal);
    closeModal(courseModal);
    closeModal(panelOverlay);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    openAddModal();
  }
});

/* ══════════════════════════════
   INIT
══════════════════════════════ */
function init() {
  loadCourses();
  populateCourseSelect();
  const settings = getEmailSettings();
  initEmailJS(settings);
  renderTable();
  updateStats();
}

/* Expose globally for inline onclick handlers */
window.openViewModal = openViewModal;
window.openEditModal = openEditModal;
window.openDeleteModal = openDeleteModal;
window.downloadSinglePdf = downloadSinglePdf;
window.handleSignOut = handleSignOut;

init();
