// Shared state, rendering, sign-in, household loading and navigation.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
let lang = 'en';
try { lang = localStorage.getItem('homemenu-lang') || 'en'; } catch (e) {}
let session = null;
let hh = null;            // { id, name, role }
let tab = 'today';
let notice = '';          // green/amber message
let problem = '';         // red message
let recipeFilter = '';
let openRecipeId = null;
let mealForm = false;
let itemForm = false;
let ruleForm = false;
let cache = {};           // data loaded for the current tab
let needsHousehold = false; // signed in, but not yet in any household

const t = (k) => (TEXT[lang] && TEXT[lang][k]) || TEXT.en[k] || k;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameOf = (en, ar) => (lang === 'ar' && ar) ? ar : (en || ar || '');
const can = {
  stock: () => hh && (hh.role === 'admin' || hh.role === 'helper'),
  rules: () => hh && (hh.role === 'admin' || hh.role === 'member'),
  approve: () => hh && (hh.role === 'admin' || hh.role === 'member'),
  cook: () => hh && (hh.role === 'admin' || hh.role === 'helper'),
  suggest: () => !!hh,
  people: () => hh && hh.role === 'admin',
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
  nav.hidden = false;
  nav.innerHTML = navHtml();
  app.innerHTML = `
    <div class="top">
      <div>
        <div class="muted">${esc(hh.name)}</div>
        <h1>${esc(t(tab))}</h1>
      </div>
      <div>${langButton()}</div>
    </div>
    ${messages()}
    <div id="screen">${cache.screenHtml || ''}</div>
    <p class="center"><button class="btn secondary small" onclick="signOut()">${t('signOut')}</button></p>`;
}

function navHtml() {
  const tabs = ['today', 'kitchen', 'recipes', 'rules'];
  if (can.people()) tabs.push('members');
  return tabs.map((k) => `<button class="${k === tab ? 'on' : ''}" onclick="go('${k}')">${esc(t(k))}</button>`).join('');
}

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
  render();
}

async function loadHousehold() {
  needsHousehold = false;
  const { data, error } = await sb
    .from('household_members')
    .select('household_id, role, households(name)')
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
  hh = { id: row.household_id, role: row.role, name: row.households?.name || '' };
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
  // A new household starts with this person as its admin. Family members can join with a code.
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
  notice = ''; problem = '';
  mealForm = false; itemForm = false; ruleForm = false; openRecipeId = null;
  await loadTab();
}

async function loadTab() {
  cache.screenHtml = '<p class="muted">' + esc(t('loading')) + '</p>';
  render();
  try {
    if (tab === 'today') cache.screenHtml = await screenToday();
    if (tab === 'kitchen') cache.screenHtml = await screenKitchen();
    if (tab === 'recipes') cache.screenHtml = await screenRecipes();
    if (tab === 'rules') cache.screenHtml = await screenRules();
    if (tab === 'members') cache.screenHtml = await screenMembers();
  } catch (e) {
    cache.screenHtml = '';
    problem = t('errorPrefix') + (e.message || e);
  }
  render();
}

function roleNote() {
  return hh.role === 'helper' ? t('helperNote') : hh.role === 'admin' ? t('adminNote') : t('memberNote');
}
