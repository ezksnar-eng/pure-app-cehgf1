/* =====================================================================
   auth.js — حسابات المستخدمين (Firebase Authentication: إيميل + كلمة سر)
   =====================================================================
   - أي شخص يكدر ينشئ حساب بإيميل وكلمة سر.
   - الحساب اللي إيميله = CONFIG.ADMIN_EMAIL يصير "إدارة" تلقائياً.
   - الإدارة تنفتح فقط إذا الإيميل مؤكَّد (Verified)؛ لأن أي شخص كان يكدر يسجّل
     بإيميل المدير قبله — التأكيد يثبت ان صاحب الإيميل الفعلي هو اللي دخل.
   - مهم: لازم تفعّل Email/Password من Firebase Console ← Authentication ←
     Sign-in method.
   ===================================================================== */
const Auth = (function () {
  const FB_VER = '10.8.0';
  let mod = null, auth = null, user = null, ready = false;
  const listeners = [];

  function adminEmail() {
    return String((window.CONFIG && CONFIG.ADMIN_EMAIL) || '').trim().toLowerCase();
  }
  function isAdminEmail(email) { return !!email && String(email).trim().toLowerCase() === adminEmail(); }

  const ERR = {
    'auth/email-already-in-use': 'هذا الإيميل مسجّل مسبقاً — جرّب تسجيل الدخول',
    'auth/invalid-email': 'صيغة الإيميل غير صحيحة',
    'auth/weak-password': 'كلمة السر ضعيفة — لازم 6 أحرف أو أكثر',
    'auth/missing-password': 'اكتب كلمة السر',
    'auth/user-not-found': 'ماكو حساب بهذا الإيميل',
    'auth/wrong-password': 'كلمة السر غير صحيحة',
    'auth/invalid-credential': 'الإيميل أو كلمة السر غير صحيحة',
    'auth/too-many-requests': 'محاولات كثيرة — انتظر شوية وجرّب مرة ثانية',
    'auth/network-request-failed': 'ماكو اتصال بالإنترنت',
    'auth/operation-not-allowed': 'تسجيل الإيميل غير مفعّل — فعّل Email/Password من Firebase Console ← Authentication ← Sign-in method',
    'auth/configuration-not-found': 'خدمة Authentication غير مفعّلة بمشروع Firebase — اضغط Get started من لوحة Authentication',
  };
  function friendly(e) {
    const code = e && e.code;
    return ERR[code] || ('خطأ: ' + ((e && e.message) || e));
  }

  async function init() {
    if (typeof Store === 'undefined' || Store.mode !== 'firebase' || !Store.fbApp) { ready = true; return; }
    try {
      mod = await import('https://www.gstatic.com/firebasejs/' + FB_VER + '/firebase-auth.js');
      auth = mod.getAuth(Store.fbApp);
      await new Promise((resolve) => {
        let first = true;
        const timer = setTimeout(() => { if (first) { first = false; resolve(); } }, 6000);
        mod.onAuthStateChanged(auth, (u) => {
          user = u;
          if (first) { first = false; clearTimeout(timer); resolve(); }
          else listeners.forEach((f) => { try { f(); } catch (e) { /* */ } });
        });
      });
    } catch (e) {
      console.error('[Auth] تعذّر تحميل نظام الحسابات:', e);
      auth = null;
    }
    ready = true;
  }

  function available() { return !!auth; }
  function current() { return user; }
  function loggedIn() { return !!user; }
  function isAdminAccount() { return !!user && isAdminEmail(user.email); }
  // "إدارة فعلية" = إيميل المدير + إيميل مؤكَّد
  function isAdmin() { return isAdminAccount() && !!user.emailVerified; }
  function onChange(f) { listeners.push(f); }

  async function signUp(email, password, name) {
    if (!auth) throw new Error('نظام الحسابات يحتاج اتصال Firebase');
    const cred = await mod.createUserWithEmailAndPassword(auth, email.trim(), password);
    if (name) { try { await mod.updateProfile(cred.user, { displayName: name.trim() }); } catch (e) { /* */ } }
    try { await mod.sendEmailVerification(cred.user); } catch (e) { console.warn('verification mail:', e); }
    user = auth.currentUser;
    return cred.user;
  }
  async function signIn(email, password) {
    if (!auth) throw new Error('نظام الحسابات يحتاج اتصال Firebase');
    const cred = await mod.signInWithEmailAndPassword(auth, email.trim(), password);
    user = cred.user;
    return cred.user;
  }
  async function signOut() { if (auth) { await mod.signOut(auth); user = null; } }
  async function resendVerification() {
    if (!auth || !auth.currentUser) throw new Error('سجّل الدخول أول');
    await mod.sendEmailVerification(auth.currentUser);
  }
  // بعد ما يضغط المستخدم رابط التأكيد بإيميله نحدّث حالته من السيرفر
  async function refresh() {
    if (!auth || !auth.currentUser) return;
    await auth.currentUser.reload();
    try { await auth.currentUser.getIdToken(true); } catch (e) { /* */ }
    user = auth.currentUser;
  }
  async function resetPassword(email) {
    if (!auth) throw new Error('نظام الحسابات يحتاج اتصال Firebase');
    await mod.sendPasswordResetEmail(auth, email.trim());
  }

  return { init, available, current, loggedIn, isAdmin, isAdminAccount, isAdminEmail, onChange, signUp, signIn, signOut, resendVerification, refresh, resetPassword, friendly };
})();
