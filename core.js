// Shared state, rendering, sign-in, household loading and navigation.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
let lang = 'en';
try { lang = localStorage.getItem('homemenu-lang') || 'en'; } catch (e) {}
let session = null;
let hh = null;            // { id, name, role, owner }
let tab = 'home';
let notice = '';          // green/amber message
let problem = '';         // red message
let recipeFilter = '';
let openRecipeId = null;
let mealForm = false;
let itemForm = false;
let ruleForm = false;
let cache = {};           // data loaded for the current tab
let needsHousehold = false; // signed in, but not yet in any household
let needsSetup = false;     // in a household, but has not finished the first-time questions
let drawerOpen = false;     // the side menu (tabs and profile)
let lastViewKey = '';       // the screen on show, so only a real change of screen animates
// Which screen is showing: 'main:<tab>' or 'setup:<step>'. Returns the class that plays the entrance once per change.
function screenClass(key) {
  if (cache.loading) return '';
  const enter = key !== lastViewKey;
  lastViewKey = key;
  return enter ? ' enter' : '';
}

const t = (k) => (TEXT[lang] && TEXT[lang][k]) || TEXT.en[k] || k;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameOf = (en, ar) => (lang === 'ar' && ar) ? ar : (en || ar || '');
// Two roles: 'helper' is the cook, 'member' is a family member. The owner is a flag on top of a role.
const can = {
  stock: () => !!hh && hh.role === 'helper',
  cook: () => !!hh && hh.role === 'helper',
  rules: () => !!hh && (hh.role === 'member' || hh.owner),
  approve: () => !!hh && (hh.role === 'member' || hh.owner),
  suggest: () => !!hh,
  people: () => !!hh && hh.owner,
  deleteMeal: () => !!hh && hh.owner,
};

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  try { localStorage.setItem('homemenu-lang', lang); } catch (e) {}
}
function setLang(l) { lang = l; applyLang(); render(); }
function langButton() {
  return `<button class="btn secondary small" onclick="setLang('${lang === 'en' ? 'ar' : 'en'}')">${t('langButton')}</button>`;
}
function messages() {
  let out = '';
  if (problem) out += `<div class="error">${esc(problem)}</div>`;
  if (notice) out += `<div class="notice">${esc(notice)}</div>`;
  return out;
}
function setProblem(err) {
  problem = t('errorPrefix') + (err && err.message ? err.message : String(err));
  notice = '';
  render();
}
function setNotice(msg) { notice = msg; problem = ''; render(); }

function render() {
  applyLang();
  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  if (!session) {
    nav.hidden = true;
    app.innerHTML = renderSignIn();
    return;
  }
  if (!hh && needsHousehold) {
    nav.hidden = true;
    app.innerHTML = renderJoin();
    return;
  }
  if (!hh) {
    nav.hidden = true;
    app.innerHTML = `<div class="top"><h1>Home Menu</h1><div>${langButton()}</div></div>
      ${messages()}
      <div class="card"><button class="btn" onclick="retryLoad()">${esc(t('retry'))}</button></div>
      <p class="center"><button class="btn secondary small" onclick="signOut()">${t('signOut')}</button></p>`;
    return;
  }
  if (needsSetup && showIntro) {
    nav.hidden = true;
    app.innerHTML = renderIntro();
    return;
  }
  if (needsSetup) {
    nav.hidden = true;
    app.innerHTML = `<div class="top"><h1>Home Menu</h1><div>${langButton()}</div></div>
      ${messages()}
      <div id="screen" class="${screenClass('setup:' + setupStep)}">${renderSetup()}</div>`;
    return;
  }
  // After the first-time questions, the guided tour starts once (until it is finished or skipped).
  if (!hh.tourDone && tourStep === null) {
    startTour();
    nav.hidden = true;
    app.innerHTML = `<p class="center muted">${esc(t('loading'))}</p>`;
    setTimeout(() => loadTab(), 0);
    return;
  }
  // The side menu is built once per household and role, so it can slide in and out without being redrawn.
  nav.hidden = false;
  const key = drawerKey();
  if (nav.dataset.key !== key) { nav.dataset.key = key; nav.innerHTML = drawerHtml(); }
  // Read the closed position first, so the browser has a starting point and the slide plays.
  if (drawerOpen) void nav.offsetWidth;
  nav.classList.toggle('open', drawerOpen);
  nav.querySelectorAll('.drawer-item').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  app.innerHTML = `
    <div class="top">
      <button class="icon-btn" onclick="openDrawer()" aria-label="${esc(t('menu'))}" aria-expanded="${drawerOpen}">${MENU_ICON}</button>
      <div>
        <div class="muted">${esc(hh.name)}</div>
        <h1>${esc(t(tab))}</h1>
      </div>
      <div>${langButton()}</div>
    </div>
    ${messages()}
    <div id="screen" class="${screenClass('main:' + tab)}">${cache.screenHtml || ''}</div>
    ${tourHtml()}`;
}

// The side menu: the tabs, and Profile (where sign out lives).
const MENU_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;

function drawerKey() { return [hh.id, hh.name, can.people()].join('|'); }

function drawerHtml() {
  const items = ['home', 'today', 'kitchen', 'recipes', 'rules'];
  if (can.people()) items.push('members');
  items.push('profile');
  return `
    <div class="scrim" onclick="closeDrawer()"></div>
    <aside class="drawer" role="dialog" aria-label="${esc(t('menu'))}">
      <div class="drawer-head">
        <div class="muted">${esc(hh.name)}</div>
        <button class="btn secondary small" onclick="closeDrawer()">${esc(t('close'))}</button>
      </div>
      <ul class="clean">
        ${items.map((k) => `<li><button class="drawer-item" data-tab="${k}" onclick="go('${k}')">${esc(t(k))}</button></li>`).join('')}
      </ul>
    </aside>`;
}

function openDrawer() { drawerOpen = true; render(); }
function closeDrawer() { drawerOpen = false; render(); }

// ---------------------------------------------------------------
// Sign in and households
// ---------------------------------------------------------------
function renderSignIn() {
  return `
    <div class="center">
      <h1>Home Menu</h1>
      <p class="muted">${esc(TEXT[lang].tagline)}</p>
      <p><button class="chip" onclick="setLang('${lang === 'en' ? 'ar' : 'en'}')">${t('langButton')}</button></p>
    </div>
    ${messages()}
    <div class="card">
      <button class="btn" onclick="signIn()">${t('signIn')}</button>
    </div>`;
}

async function signIn() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: APP_URL },
  });
  if (error) setProblem(error);
}

async function signOut() {
  await sb.auth.signOut();
  session = null; hh = null; cache = {}; notice = ''; problem = '';
  needsSetup = false; setupData = null; setupStep = 0;
  showIntro = false; tourStep = null; tourList = [];
  render();
}

async function loadHousehold() {
  needsHousehold = false;
  needsSetup = false;
  const { data, error } = await sb
    .from('household_members')
    .select('household_id, role, is_owner, households(name)')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) { problem = error.message; hh = null; return; }
  if (!data || !data.length) {
    // Not in a household yet: ask for an invite code, or create one.
    hh = null;
    needsHousehold = true;
    return;
  }
  const row = data[0];
  hh = { id: row.household_id, role: row.role, owner: !!row.is_owner, name: row.households?.name || '' };
  // Everyone answers the first-time questions once, after joining or creating a household.
  const { data: s } = await sb.from('member_settings').select('setup_done, tour_done').eq('user_id', session.user.id).maybeSingle();
  needsSetup = !(s && s.setup_done);
  hh.tourDone = !!(s && s.tour_done);
  // A brand-new person sees the welcome animation first, before the questions.
  if (needsSetup && setupStep === 0) showIntro = true;
}

async function retryLoad() {
  problem = '';
  await loadHousehold();
  if (hh) await loadTab(); else render();
}

function renderJoin() {
  return `
    <div class="top"><h1>Home Menu</h1><div>${langButton()}</div></div>
    ${messages()}
    <div class="card">
      <h2 style="margin-top:0">${esc(t('joinTitle'))}</h2>
      <p class="muted">${esc(t('joinText'))}</p>
      <label>${esc(t('inviteCode'))}</label>
      <input id="joincode" autocapitalize="characters" autocomplete="off" placeholder="${esc(t('inviteCodeExample'))}">
      <button class="btn" onclick="joinWithCode()">${esc(t('joinWithCode'))}</button>
    </div>
    <div class="card">
      <button class="btn secondary" onclick="createHousehold()">${esc(t('createOwn'))}</button>
    </div>
    <p class="center"><button class="btn secondary small" onclick="signOut()">${t('signOut')}</button></p>`;
}

async function joinWithCode() {
  const code = document.getElementById('joincode').value.trim();
  if (!code) return setProblem(new Error(t('inviteCode')));
  const { error } = await sb.rpc('redeem_invite_code', { p_code: code });
  if (error) return setProblem(error);
  problem = '';
  await loadHousehold();
  if (hh) { notice = t('joined'); await loadTab(); } else render();
}

async function createHousehold() {
  // The person who creates a household becomes its owner. Everyone else joins with an invite code.
  const { error } = await sb.rpc('create_household', { p_name: t('myHousehold') });
  if (error) return setProblem(error);
  problem = '';
  await loadHousehold();
  if (hh) await loadTab(); else render();
}

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
async function go(k) {
  tab = k;
  drawerOpen = false;
  notice = ''; problem = '';
  mealForm = false; itemForm = false; ruleForm = false; openRecipeId = null;
  await loadTab();
}

async function loadTab() {
  cache.screenHtml = '<p class="muted">' + esc(t('loading')) + '</p>';
  cache.loading = true;
  render();
  try {
    if (tab === 'home') cache.screenHtml = await screenHome();
    if (tab === 'today') cache.screenHtml = await screenToday();
    if (tab === 'kitchen') cache.screenHtml = await screenKitchen();
    if (tab === 'recipes') cache.screenHtml = await screenRecipes();
    if (tab === 'rules') cache.screenHtml = await screenRules();
    if (tab === 'members') cache.screenHtml = await screenMembers();
    if (tab === 'profile') cache.screenHtml = await screenProfile();
  } catch (e) {
    cache.screenHtml = '';
    problem = t('errorPrefix') + (e.message || e);
  }
  cache.loading = false;
  render();
}

function roleNote() {
  return hh.role === 'helper' ? t('helperNote') : t('memberNote');
}
