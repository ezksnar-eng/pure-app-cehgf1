/* =====================================================================
   admin.js — صفحة الحساب + لوحة الإدارة (استيراد + حذف قاعدة البيانات)
   تعتمد على دوال app.js (setView, topbar, esc, toast, nav, showModal, ...)
   وتُستدعى من الموجّه (render) عند route.name = 'account' أو 'admin'
   ===================================================================== */

/* ---------- إعدادات محفوظة محلياً بجهاز المدير ---------- */
const AdminPrefs = (function () {
  const KEY = 'pm_admin_prefs_v1';
  function all() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function get(k, d) { const v = all()[k]; return (v === undefined || v === null || v === '') ? d : v; }
  function set(k, v) { try { const a = all(); a[k] = v; localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { /* */ } }
  return { get, set };
})();

function getImporter() {
  if (!window.__importer) window.__importer = PureImporter.createImporter({ Store });
  return window.__importer;
}

/* =====================================================================
   صفحة الحساب: تسجيل دخول / إنشاء حساب / ملف المستخدم
   ===================================================================== */
async function pageAccount() {
  if (!Auth.available()) {
    setView(`
      ${topbar('حسابي')}
      ${emptyState('نظام الحسابات غير متاح', Store.mode === 'firebase'
        ? 'تعذّر تحميل Firebase Authentication — تأكد من الاتصال بالإنترنت وأعد فتح التطبيق'
        : 'الحسابات تحتاج اتصال Firebase مفعّل بملف config.js')}
    `);
    return;
  }
  if (Auth.loggedIn()) return renderProfile();
  renderAuthForm(route.mode === 'signup' ? 'signup' : 'login');
}

function renderAuthForm(mode) {
  const isSignup = mode === 'signup';
  setView(`
    ${topbar('حسابي')}
    <div class="type-switch">
      <button class="${!isSignup ? 'active' : ''}" id="tabLogin">تسجيل الدخول</button>
      <button class="${isSignup ? 'active' : ''}" id="tabSignup">إنشاء حساب</button>
    </div>
    <div class="admin-card">
      ${isSignup ? `<div class="field"><label>الاسم (اختياري)</label><input type="text" id="au_name" autocomplete="name"></div>` : ''}
      <div class="field"><label>الإيميل</label><input type="email" id="au_email" autocomplete="email" inputmode="email" dir="ltr" placeholder="name@example.com"></div>
      <div class="field"><label>كلمة السر</label><input type="password" id="au_pass" autocomplete="${isSignup ? 'new-password' : 'current-password'}" dir="ltr"></div>
      ${isSignup ? `<div class="field"><label>تأكيد كلمة السر</label><input type="password" id="au_pass2" autocomplete="new-password" dir="ltr"></div>` : ''}
      <div class="admin-err" id="au_err"></div>
      <button class="btn btn-accent btn-block" id="au_go">${isSignup ? 'إنشاء الحساب' : 'دخول'}</button>
      ${!isSignup ? `<button class="btn btn-outline btn-block" id="au_forgot" style="margin-top:8px">نسيت كلمة السر؟</button>` : ''}
    </div>
  `);
  document.getElementById('tabLogin').onclick = () => nav({ name: 'account', mode: 'login' });
  document.getElementById('tabSignup').onclick = () => nav({ name: 'account', mode: 'signup' });
  const err = (m) => { document.getElementById('au_err').textContent = m || ''; };
  const go = document.getElementById('au_go');
  go.onclick = async () => {
    const email = document.getElementById('au_email').value.trim();
    const pass = document.getElementById('au_pass').value;
    err('');
    if (!email || !pass) { err('اكتب الإيميل وكلمة السر'); return; }
    if (isSignup && pass !== document.getElementById('au_pass2').value) { err('كلمتا السر غير متطابقتين'); return; }
    go.disabled = true; go.textContent = 'لحظة...';
    try {
      if (isSignup) {
        await Auth.signUp(email, pass, document.getElementById('au_name').value);
        toast(Auth.isAdminEmail(email) ? 'تم إنشاء حساب الإدارة — فعّل بريدك لفتح اللوحة' : 'تم إنشاء الحساب — راجع بريدك لتأكيده');
      } else {
        await Auth.signIn(email, pass);
        toast('تم تسجيل الدخول');
      }
      renderDrawer();
      nav({ name: 'account' });
    } catch (e) {
      err(Auth.friendly(e));
      go.disabled = false; go.textContent = isSignup ? 'إنشاء الحساب' : 'دخول';
    }
  };
  const forgot = document.getElementById('au_forgot');
  if (forgot) forgot.onclick = async () => {
    const email = document.getElementById('au_email').value.trim();
    if (!email) { err('اكتب إيميلك فوق أول'); return; }
    try { await Auth.resetPassword(email); toast('أرسلنا رابط تغيير كلمة السر لإيميلك'); } catch (e) { err(Auth.friendly(e)); }
  };
}

function renderProfile() {
  const u = Auth.current();
  const isAdminAcc = Auth.isAdminAccount();
  setView(`
    ${topbar('حسابي')}
    <div class="admin-card">
      <div class="profile-row"><div class="avatar">${esc((u.displayName || u.email || '?').trim().charAt(0).toUpperCase())}</div>
        <div style="min-width:0"><b>${esc(u.displayName || 'مستخدم')}</b>
          <div class="sub" dir="ltr" style="text-align:right">${esc(u.email)}</div></div>
        ${isAdminAcc ? '<span class="role-badge">إدارة</span>' : ''}
      </div>
      ${!u.emailVerified ? `
        <div class="admin-note warn">
          إيميلك غير مؤكَّد بعد. ${isAdminAcc ? 'لوحة الإدارة تنفتح بعد التأكيد.' : ''}
          افتح رسالة التأكيد بإيميلك (شوف الـ Spam هم) ثم اضغط "حدّث الحالة".
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" id="pf_resend">أعد إرسال الرابط</button>
          <button class="btn btn-accent" id="pf_refresh">حدّث الحالة</button>
        </div>` : '<div class="admin-note ok">الإيميل مؤكَّد ✓</div>'}
      ${Auth.isAdmin() ? `<button class="btn btn-accent btn-block" id="pf_admin" style="margin-top:10px">فتح لوحة الإدارة</button>` : ''}
      <button class="btn btn-outline btn-block" id="pf_out" style="margin-top:10px;color:var(--danger)">تسجيل الخروج</button>
    </div>
  `);
  const resend = document.getElementById('pf_resend');
  if (resend) resend.onclick = async () => { try { await Auth.resendVerification(); toast('تم إرسال رابط التأكيد'); } catch (e) { toast(Auth.friendly(e)); } };
  const refresh = document.getElementById('pf_refresh');
  if (refresh) refresh.onclick = async () => {
    try { await Auth.refresh(); renderDrawer(); toast(Auth.current().emailVerified ? 'تم التأكيد ✓' : 'لسا غير مؤكَّد'); renderProfile(); }
    catch (e) { toast(Auth.friendly(e)); }
  };
  const adm = document.getElementById('pf_admin');
  if (adm) adm.onclick = () => nav({ name: 'admin' });
  document.getElementById('pf_out').onclick = async () => { await Auth.signOut(); renderDrawer(); toast('تم تسجيل الخروج'); nav({ name: 'home' }); };
}

/* =====================================================================
   لوحة الإدارة
   ===================================================================== */
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(x).padStart(2, '0');
}
function fmtClock(t) { const d = new Date(t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':'); }

async function pageAdmin() {
  if (!Auth.isAdmin()) {
    const reason = !Auth.loggedIn() ? 'سجّل الدخول بحساب الإدارة أول'
      : (Auth.isAdminAccount() ? 'فعّل بريدك الإلكتروني حتى تنفتح لوحة الإدارة' : 'هذا القسم للإدارة فقط');
    setView(`
      ${topbar('الإدارة')}
      ${emptyState('غير مسموح', reason)}
      <div style="padding:0 16px"><button class="btn btn-accent btn-block" id="goAcc">${Auth.loggedIn() ? 'حسابي' : 'تسجيل الدخول'}</button></div>
    `);
    document.getElementById('goAcc').onclick = () => nav({ name: 'account' });
    return;
  }
  const imp = getImporter();
  const dbCount = await Store.getWorks().then((w) => w.length).catch(() => 0);

  setView(`
    ${topbar('لوحة الإدارة')}

    <div class="admin-card">
      <h3>استيراد من موقع</h3>
      <div class="admin-note">شغّل تطبيق البروكسي أول (لازم يكون شغال بالخلفية)، بعدها الصق رابط الموقع هنا. الرابط يكدر يكون: صفحة أرشيف/قائمة الأعمال، أو الصفحة الرئيسية، أو رابط عمل واحد.</div>
      <div class="field"><label>رابط الموقع</label><input type="url" id="im_site" dir="ltr" placeholder="https://example.com/series" value="${esc(AdminPrefs.get('site', ''))}"></div>
      <div class="field"><label>عنوان تطبيق البروكسي</label><input type="url" id="im_proxy" dir="ltr" value="${esc(AdminPrefs.get('proxy', (window.CONFIG && CONFIG.PROXY_URL) || 'http://127.0.0.1:8080/'))}"></div>
      <div class="field-row">
        <div class="field"><label>عدد العمال (1–70)</label><input type="number" id="im_workers" min="1" max="70" value="${esc(String(AdminPrefs.get('workers', (window.CONFIG && CONFIG.IMPORT_WORKERS) || 70)))}"></div>
        <div class="field"><label>أقصى صفحات أرشيف</label><input type="number" id="im_pages" min="1" max="2000" value="${esc(String(AdminPrefs.get('pages', 500)))}"></div>
      </div>
      <div class="admin-err" id="im_err"></div>
      <div class="admin-probe" id="im_probe"></div>
      <div class="modal-actions" style="flex-wrap:wrap">
        <button class="btn btn-outline" id="im_test">فحص الرابط</button>
        <button class="btn btn-accent" id="im_start">بدء الاستيراد</button>
      </div>
      <div class="modal-actions" id="im_ctl" style="display:none">
        <button class="btn btn-outline" id="im_pause">إيقاف مؤقت</button>
        <button class="btn btn-outline" id="im_stop" style="color:var(--danger)">إيقاف نهائي</button>
      </div>
    </div>

    <div class="admin-card" id="im_live" style="display:none">
      <h3>التقدّم <span class="sub" id="im_phase"></span></h3>
      <div class="stat-grid" id="im_stats"></div>
      <div class="sub" id="im_disc" style="margin:8px 0"></div>
      <div class="worker-grid" id="im_workersGrid"></div>
      <h3 style="margin-top:14px">السجل</h3>
      <div class="admin-log" id="im_log"></div>
    </div>

    <details class="admin-card">
      <summary>شروط ومميزات العمال</summary>
      <ul class="admin-rules">
        <li><b>أخذ حصري:</b> كل عامل ياخذ عمل واحد من الطابور، وممنوع عامل ثاني يروح عليه.</li>
        <li><b>إنهاء كامل:</b> العامل ما ينتقل لعمل ثاني إلا بعد ما يستورد كل فصول العمل الحالي.</li>
        <li><b>عدم تكرار:</b> العمل ما ينضاف مرتين — حتى لو ظهر برابطين أو أعدت الاستيراد (المكتمل يتخطّاه).</li>
        <li><b>ترتيب:</b> الفصول تنحفظ مرتبة من الأول للأخير، والأعمال تنعرض بنفس ترتيب الموقع.</li>
        <li><b>استيراد شامل:</b> الاسم، الغلاف، التقييم، القصة، التصنيفات، الحالة، النوع، وكل الفصول بصورها.</li>
        <li><b>مقاومة الأخطاء:</b> كل طلب يعيد المحاولة 4 مرات؛ الفصل الفاشل يتسجّل ويصير العمل "ناقص" ويكمل بالتشغيل الجاي بدون ما يعيد المكتمل.</li>
        <li><b>تحكم كامل:</b> إيقاف مؤقت واستئناف وإيقاف نهائي بأي لحظة، ويمنع الشاشة من الانطفاء أثناء العمل.</li>
        <li><b>ملاحظة:</b> خلّي التطبيق مفتوح لين ينتهي الاستيراد.</li>
      </ul>
    </details>

    <div class="admin-card danger-zone">
      <h3>منطقة الخطر</h3>
      <div class="admin-note">قاعدة البيانات فيها حالياً <b id="db_count">${dbCount}</b> عمل. الحذف نهائي ويشمل كل الأعمال وكل الفصول.</div>
      <button class="btn btn-outline btn-block" id="db_wipe" style="color:var(--danger);border-color:var(--danger)">${ICON.trash} حذف كل شي بقاعدة البيانات</button>
    </div>
    <div style="height:30px"></div>
  `);

  const $ = (id) => document.getElementById(id);
  const readOpts = () => ({
    siteUrl: $('im_site').value.trim(),
    proxyBase: $('im_proxy').value.trim() || 'http://127.0.0.1:8080/',
    workers: $('im_workers').value,
    maxPages: $('im_pages').value,
  });
  const saveOpts = (o) => { AdminPrefs.set('site', o.siteUrl); AdminPrefs.set('proxy', o.proxyBase); AdminPrefs.set('workers', o.workers); AdminPrefs.set('pages', o.maxPages); };

  /* --- رسم الحالة الحية (يتحدّث عند كل تغيير، بحد أقصى ~4 مرات بالثانية) --- */
  let paintTimer = null;
  function paint() {
    if (!document.getElementById('im_live')) return; // غادر المستخدم الصفحة
    const s = imp.state;
    const running = imp.isRunning();
    $('im_live').style.display = s.phase === 'idle' ? 'none' : '';
    $('im_ctl').style.display = running ? '' : 'none';
    $('im_start').disabled = running; $('im_test').disabled = running; $('db_wipe').disabled = running;
    ['im_site', 'im_proxy', 'im_workers', 'im_pages'].forEach((id) => { $(id).disabled = running; });
    $('im_pause').textContent = imp.isPaused() ? 'استئناف' : 'إيقاف مؤقت';
    const phaseTxt = { discovering: 'يكتشف الأعمال...', running: 'شغّال', done: 'انتهى', stopped: 'متوقف' }[s.phase] || '';
    const elapsed = s.startedAt ? fmtDur((s.finishedAt || Date.now()) - s.startedAt) : '';
    $('im_phase').textContent = '— ' + (imp.isPaused() ? 'موقوف مؤقتاً' : phaseTxt) + (elapsed ? ' • ' + elapsed : '');
    const st = s.stats;
    const busy = s.workers.filter((w) => w.status === 'fetch' || w.status === 'chapters').length;
    $('im_stats').innerHTML = [
      ['مُستورد', st.imported, 'ok'], ['مُكمَّل', st.resumed, 'ok'], ['متخطّى (مكرر)', st.skipped, ''],
      ['ناقص', st.partial, 'warn'], ['فشل', st.failed, 'bad'], ['فصول', st.chapters, ''],
      ['بالطابور', Math.max(0, s.discovery.found - st.imported - st.resumed - st.skipped - st.partial - st.failed - busy), ''], ['عمال شغّالين', busy + '/' + s.workersTotal, ''],
    ].map(([k, v, c]) => `<div class="stat ${c}"><b>${v}</b><span>${k}</span></div>`).join('');
    $('im_disc').textContent = 'اكتشاف الأعمال: ' + s.discovery.found + ' عمل من ' + s.discovery.pages + ' صفحة أرشيف' + (s.discovery.done ? ' (اكتمل)' : '...');
    $('im_workersGrid').innerHTML = s.workers.map((w) => {
      const pct = w.total ? Math.round(w.cur / w.total * 100) : 0;
      return `<div class="wk s-${w.status}" title="${esc(w.title)}"><b>${w.id}</b><span>${esc(w.title || ({ idle: 'فاضي', wait: 'ينتظر', paused: 'موقوف', fetch: 'يجلب...', chapters: '' }[w.status] || ''))}</span>${w.total ? `<em>${w.cur}/${w.total}</em><i style="width:${pct}%"></i>` : ''}</div>`;
    }).join('');
    const logEl = $('im_log');
    const stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 30;
    logEl.innerHTML = s.log.slice(-80).map((l) => `<div class="${l.lvl}"><span>${fmtClock(l.t)}</span> ${esc(l.msg)}</div>`).join('');
    if (stick) logEl.scrollTop = logEl.scrollHeight;
  }
  function schedulePaint() { if (paintTimer) return; paintTimer = setTimeout(() => { paintTimer = null; paint(); }, 250); }
  if (window.__impUnsub) window.__impUnsub();
  window.__impUnsub = imp.onUpdate(schedulePaint);
  paint();

  /* --- فحص الرابط --- */
  $('im_test').onclick = async () => {
    const o = readOpts(); $('im_err').textContent = ''; const box = $('im_probe');
    if (!o.siteUrl) { $('im_err').textContent = 'الصق رابط الموقع أول'; return; }
    saveOpts(o);
    box.className = 'admin-probe show'; box.textContent = 'جاري الفحص عبر البروكسي...';
    $('im_test').disabled = true;
    try {
      const r = await imp.probe(o.siteUrl, o.proxyBase);
      if (r.kind === 'work') {
        box.innerHTML = `✓ رابط <b>عمل واحد</b>: «${esc(r.title)}» — ${r.chapters} فصل • غلاف ${r.cover ? '✓' : '✗'} • تقييم ${r.rating != null ? r.rating : '✗'} • قصة ${r.hasDesc ? '✓' : '✗'} • ${r.genres} تصنيف`;
        box.classList.toggle('bad', !r.chapters);
      } else if (r.ok) {
        box.innerHTML = `✓ رابط <b>أرشيف</b>: لقيت ${r.works} عمل بهذي الصفحة${r.next ? ' • فيه صفحة تالية ✓' : ' • ما لقيت صفحة تالية'}<br><span dir="ltr" style="font-size:11px">${esc((r.sample || []).join('  ,  '))}</span>`;
      } else {
        box.innerHTML = '✗ الصفحة انجلبت (' + r.bytes + ' بايت) بس ما لقيت أعمال بيها — جرّب رابط صفحة قائمة الأعمال أو رابط عمل مباشر';
        box.classList.add('bad');
      }
    } catch (e) {
      box.innerHTML = '✗ فشل الجلب: ' + esc(e.message) + '<br>تأكد إن تطبيق البروكسي شغّال وان العنوان صحيح.';
      box.classList.add('bad');
    }
    $('im_test').disabled = false;
  };

  /* --- بدء / إيقاف مؤقت / إيقاف --- */
  let wakeLock = null;
  const keepAwake = async (on) => {
    try {
      if (on && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { /* مو كل الأجهزة تدعمها */ }
  };
  $('im_start').onclick = async () => {
    const o = readOpts(); $('im_err').textContent = '';
    if (!o.siteUrl) { $('im_err').textContent = 'الصق رابط الموقع أول'; return; }
    saveOpts(o);
    window.onbeforeunload = () => 'الاستيراد شغّال — إذا طلعت راح يتوقف';
    keepAwake(true);
    imp.start(o).catch((e) => { $('im_err').textContent = e.message; })
      .finally(() => { window.onbeforeunload = null; keepAwake(false); schedulePaint(); getImporterDbRefresh(); });
    schedulePaint();
  };
  $('im_pause').onclick = () => { if (imp.isPaused()) imp.resume(); else imp.pause(); schedulePaint(); };
  $('im_stop').onclick = () => { if (confirm('إيقاف الاستيراد نهائياً؟ اللي انحفظ يبقى، والباقي تكمله بالتشغيل الجاي.')) imp.stop(); };
  async function getImporterDbRefresh() {
    try { const n = (await Store.getWorks()).length; const el = document.getElementById('db_count'); if (el) el.textContent = n; } catch (e) { /* */ }
  }

  /* --- حذف كل شي --- */
  $('db_wipe').onclick = () => {
    showModal(`
      <h3 style="color:var(--danger)">حذف كل قاعدة البيانات</h3>
      <div class="admin-note warn">راح تنحذف كل الأعمال وكل الفصول نهائياً، وما كو رجعة. اكتب كلمة <b>حذف</b> للتأكيد.</div>
      <div class="field"><input type="text" id="wipe_in" placeholder="اكتب: حذف" autocomplete="off"></div>
      <div class="sub" id="wipe_msg" style="min-height:18px;margin-bottom:8px"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="wipe_cancel">إلغاء</button>
        <button class="btn btn-accent" id="wipe_go" style="background:var(--danger)" disabled>احذف كل شي</button>
      </div>`);
    const inp = document.getElementById('wipe_in'), go = document.getElementById('wipe_go'), msg = document.getElementById('wipe_msg');
    inp.oninput = () => { go.disabled = inp.value.trim() !== 'حذف'; };
    document.getElementById('wipe_cancel').onclick = closeModal;
    go.onclick = async () => {
      if (imp.isRunning()) { msg.textContent = 'أوقف الاستيراد أول'; return; }
      go.disabled = true; inp.disabled = true;
      try {
        const r = await Store.deleteAll((m) => { msg.textContent = m; });
        msg.textContent = 'تم الحذف: ' + r.works + ' عمل و' + r.chapters + ' فصل';
        toast('تم حذف كل شي'); getImporterDbRefresh();
        setTimeout(closeModal, 1200);
      } catch (e) {
        msg.style.color = 'var(--danger)'; msg.textContent = 'فشل الحذف: ' + (e.message || e) + ' — تأكد من قواعد Firestore';
        inp.disabled = false;
      }
    };
  };
}
