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
let lastViewKey = '';       // the screen on show, so only a real change of screen animates
let testPassword = null;    // kept only while the test account is signed in, so sign out can reset it
let screenBusy = false;     // true while a screen is refreshing with its old content still showing
let roleMenuOpen = false;   // the top-bar role menu
// Which screen is showing: 'main:<tab>' or 'setup:<step>'. Returns the class that plays the entrance once per change.
function screenClass(key) {
  if (cache.loading) return '';
  const enter = key !== lastViewKey;
  lastViewKey = key;
  return enter ? ' enter' : '';
}

// ---------------------------------------------------------------
// Motion. Timings live in the CSS variables (styles-home.css), so each one is set in one place.
// With "reduce motion" on, everything reads as 0 and the end state is shown straight away.
// ---------------------------------------------------------------
function motion(name, fallback) {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (raw.endsWith('ms')) return parseFloat(raw);
  if (raw.endsWith('s')) return parseFloat(raw) * 1000;
  return fallback;
}

// Folds (forms and details that open in place). foldEnter gives the entrance once, the first time a form is shown.
// A refresh that redraws it later gets no entrance, so nothing replays.
const shownFolds = new Set();
function foldEnter(key) {
  if (shownFolds.has(key)) return '';
  shownFolds.add(key);
  return ' enter';
}
// Folds the form closed in place, then runs done (which redraws without it).
function foldClose(key, done) {
  const el = document.querySelector(`[data-fold="${key}"]`);
  if (!el) { shownFolds.delete(key); return done(); }
  if (el.classList.contains('closing')) return;
  el.classList.add('closing');
  setTimeout(() => { shownFolds.delete(key); done(); }, motion('--pick-close', 380));
}

// Forms that open at once. Opening puts the form in place of the content it needs room for, using the data already
// on screen, so there is no wait for the network. Cancel puts that content back below the form, folds the form away,
// then runs reset(). A quiet reload from the network happens only when no content was put back (or after a save).
const openForms = {};   // form key -> { html: the content the form replaced, hidden: elements hidden while it is open }
// Keeps the saved copy of the screen in step with what is on screen, so a later redraw shows the same thing.
function syncScreenHtml() {
  const screen = document.getElementById('screen');
  if (!screen) return;
  const copy = screen.cloneNode(true);
  copy.querySelectorAll('.enter, .closing').forEach((n) => n.classList.remove('enter', 'closing'));
  cache.screenHtml = copy.innerHTML;
}
// The element that holds a form: its fold wrapper, or the list item around it.
function formBox(key) {
  const wrap = document.querySelector(`[data-fold="${key}"]`);
  if (!wrap) return null;
  return wrap.parentElement && wrap.parentElement.tagName === 'LI' ? wrap.parentElement : wrap;
}
// Puts the form in place of what find() returns: { els, hide }. els are replaced; hide are hidden while the form is open.
// Any other open form is put back first. Returns false if there is nothing to replace, so the caller can reload instead.
function openFormNow(key, find, formHtml) {
  closeOpenFormsNow(key);
  const found = find();
  if (!found || !found.els || !found.els.length) return false;
  const hide = found.hide || [];
  openForms[key] = { html: found.els.map((e) => e.outerHTML).join(''), hidden: hide };
  hide.forEach((e) => e.classList.add('form-hidden'));
  found.els[0].insertAdjacentHTML('beforebegin', formHtml);
  found.els.forEach((e) => e.remove());
  syncScreenHtml();
  return true;
}
// Puts back, at once and without animation, any open form other than except.
function closeOpenFormsNow(except) {
  for (const key of Object.keys(openForms)) {
    if (key === except) continue;
    const rec = openForms[key];
    rec.hidden.forEach((e) => e.classList.remove('form-hidden'));
    const box = formBox(key);
    if (box) { box.insertAdjacentHTML('afterend', rec.html); box.remove(); }
    delete openForms[key];
  }
}
// Closes a form: the content it replaced goes back below it, the form folds away, then reset() runs, then after()
// (or a quiet reload, when nothing was put back). replacement, if given, is put back in place of the saved content.
function closeFormNow(key, reset, after, replacement) {
  const wrap = document.querySelector(`[data-fold="${key}"]`);
  if (wrap && wrap.classList.contains('closing')) return;
  const rec = openForms[key];
  if (rec) { rec.hidden.forEach((e) => e.classList.remove('form-hidden')); delete openForms[key]; }
  const box = formBox(key);
  if (!box) { reset(); if (after) after(); else loadTab({ quiet: true }); return; }
  const finish = () => { reset(); if (after) after(); else if (!rec) loadTab({ quiet: true }); };
  const back = replacement !== undefined ? replacement : (rec && rec.html);
  if (back) box.insertAdjacentHTML('afterend', back);
  foldClose(key, () => { box.remove(); syncScreenHtml(); finish(); });
}

// Keeps where the user was scrolled through a redraw: the page, and any list with data-keep-scroll.
function captureScroll() {
  return { page: window.scrollY, lists: [...document.querySelectorAll('[data-keep-scroll]')].map((e) => e.scrollTop) };
}
function restoreScroll(s) {
  window.scrollTo(0, s.page);
  document.querySelectorAll('[data-keep-scroll]').forEach((e, i) => { if (s.lists[i] !== undefined) e.scrollTop = s.lists[i]; });
}

const t = (k) => (TEXT[lang] && TEXT[lang][k]) || TEXT.en[k] || k;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameOf = (en, ar) => (lang === 'ar' && ar) ? ar : (en || ar || '');
// Two roles: 'helper' is the cook, 'member' is a family member. The owner is a flag on top of a role.
// viewRole is for testing only: it changes the layout and what the screens offer, but not the stored role.
let viewRole = null;
function activeRole() { return viewRole || (hh ? hh.role : 'member'); }
// The tabs each role sees. Settings is always there too, added in tabBarHtml.
const ROLE_TABS = {
  member: ['home', 'today', 'recipes', 'kitchen'],
  helper: ['home', 'planner', 'recipes', 'kitchen'],
};
const can = {
  stock: () => !!hh && activeRole() === 'helper',     // cooks change the kitchen stock
  cook: () => !!hh && activeRole() === 'helper',      // cooks mark meals as cooked
  rules: () => !!hh,                                  // everyone sets rules
  approve: () => !!hh && activeRole() === 'member',   // family members approve meals
  suggest: () => !!hh && activeRole() === 'member',   // family members add and edit meals
  people: () => !!hh && hh.owner,
  deleteMeal: () => !!hh && hh.owner,
};

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  try { localStorage.setItem('homemenu-lang', lang); } catch (e) {}
}
// Switching language: the screen fades out, the new language is drawn, and it fades back in.
async function setLang(l) {
  if (lang === l) return;
  const app = document.getElementById('app');
  if (app) app.classList.add('switching');
  await new Promise((r) => setTimeout(r, motion('--lang-ms', 180)));
  lang = l; applyLang(); render();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.getElementById('app');
    if (el) el.classList.remove('switching');
  }));
}
function langButton() {
  return `<button class="btn secondary small" onclick="setLang('${lang === 'en' ? 'ar' : 'en'}')">${t('langButton')}</button>`;
}
// The view switcher in the top bar (testing only): shows the layout for Cook or Family member.
// It does not change the stored role; that is set in Settings.
async function switchView(next) {
  viewRole = next === hh.role ? null : next;
  problem = '';
  // Leave a tab the new view does not have.
  if (!ROLE_TABS[activeRole()].includes(tab) && tab !== 'profile') tab = 'home';
  mealForm = false; mealEditId = null; openRecipeId = null;
  await loadTab();
}
function messages() {
  let out = '';
  if (problem) out += `<div class="error">${esc(problem)}</div>`;
  // Success messages pop up briefly and then go away on their own (see watchNotice).
  if (notice) out += `<div class="toast" role="status">${esc(notice)}</div>`;
  return out;
}
let noticeTimer = null;
let noticeTimerText = null;
// Clears a success message a couple of seconds after it appears. A new message starts its own timer.
function watchNotice() {
  if (!notice) return;
  if (noticeTimer && noticeTimerText === notice) return;
  clearTimeout(noticeTimer);
  noticeTimerText = notice;
  noticeTimer = setTimeout(() => { notice = ''; noticeTimer = null; render(); }, 2200);
}
function setProblem(err) {
  problem = t('errorPrefix') + (err && err.message ? err.message : String(err));
  notice = '';
  render();
}
function setNotice(msg) { notice = msg; problem = ''; render(); }

function render() {
  applyLang();
  watchNotice();
  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  if (!session) {
    nav.hidden = true;
    // A new visitor sees the welcome first; then the sign-in screen animates in.
    app.innerHTML = showIntro ? renderIntro() : `<div class="signin-in">${renderSignIn()}</div>`;
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
  if (needsSetup) {
    nav.hidden = true;
    app.innerHTML = `<div class="top"><h1>Home Menu</h1><div>${langButton()}</div></div>
      ${messages()}
      <div id="screen" class="${screenClass('setup:' + setupStep)}">${renderSetup()}</div>`;
    return;
  }
  // After the first-time questions, the guided tour starts once (until it is finished or skipped).
  if (!hh.tourDone && tourStep === null) startTour();   // the tour shows over the screen that is loading, with no second load
  // The tab bar is built once per household and role; after that only its active tab changes.
  nav.hidden = false;
  const key = tabBarKey();
  if (nav.dataset.key !== key) { nav.dataset.key = key; nav.innerHTML = tabBarHtml(); }
  nav.querySelectorAll('.tab-item').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  if (typeof drawMealTimes === 'function') drawMealTimes();   // the meal times bar on Home (home-suggest.js); it hides on the other tabs
  const keepScroll = captureScroll();
  // The family Home's top bar is the greeting, as in the mockup.
  const homeTop = tab === 'home' && activeRole() === 'member' && typeof homeTimes === 'function' ? homeTimes() : null;
  app.innerHTML = `
    <div class="top">
      <div class="top-title">
        ${homeTop ? '' : `<div class="muted">${esc(hh.name)}</div>`}
        <h1>${esc(homeTop ? homeTop.greeting : t(tab))}</h1>
      </div>
      <div class="top-actions">${roleToggleHtml()}</div>
    </div>
    ${messages()}
    <div id="screen" class="${screenClass('main:' + tab)}${screenBusy ? ' busy' : ''}">${cache.screenHtml || ''}</div>
    ${tourHtml()}`;
  restoreScroll(keepScroll);
  // The family Home sets up its greeting and meals sheet once the screen is in place.
  if (tab === 'home') setupHome(cache.playIntro);
}

// The bottom tab bar: the tabs each role sees, and Settings (where sign out and the language live).
const TAB_ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  today: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3z"/><path d="M21 15v7"/>',
  planner: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  recipes: '<path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z"/><path d="M6 16a2 2 0 0 1 2-2h10"/>',
  kitchen: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 10h14"/><path d="M9 6.5v1.5M9 13v2"/>',
  profile: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2L10 21h4l.6-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
};

// The bar is rebuilt when its contents change, including the language, so its labels stay right.
function tabBarKey() { return [hh.id, can.people(), activeRole(), lang].join('|'); }

function tabBarHtml() {
  const items = [...ROLE_TABS[activeRole()], 'profile'];
  return `<nav class="tab-bar" aria-label="${esc(t('menu'))}">${items.map((k) => {
    const label = (k === 'today' || k === 'planner') ? t('mealsTab') : t(k);
    return `<button class="tab-item${tab === k ? ' on' : ''}" data-tab="${k}" onclick="go('${k}')" aria-label="${esc(label)}" ${tab === k ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${TAB_ICONS[k]}</svg>
      <span class="tab-label">${esc(label)}</span>
    </button>`;
  }).join('')}</nav><div id="mtBar" role="tablist"></div>`;
}

// Family member / Cook, as a two-way toggle at the top of each screen.
function roleToggleHtml() {
  const current = activeRole();
  return `<div class="seg role-seg" role="group" aria-label="${esc(t('switchView'))}">
    ${[['member', 'role_member'], ['helper', 'role_helper']].map(([v, k]) =>
      `<button class="${current === v ? 'on' : ''}" aria-pressed="${current === v}" onclick="switchView('${v}')">${esc(t(k))}</button>`).join('')}
  </div>`;
}

// ---------------------------------------------------------------
// Sign in and households
// ---------------------------------------------------------------
function renderSignIn() {
  return `
    <div class="center">
      <h1>Home Menu</h1>
      <h2 class="signin-hello">${esc(t('letsStart'))}</h2>
      <p class="muted">${esc(TEXT[lang].tagline)}</p>
      <p><button class="chip" onclick="setLang('${lang === 'en' ? 'ar' : 'en'}')">${t('langButton')}</button></p>
    </div>
    ${messages()}
    <div class="card">
      <button class="btn" onclick="signIn()">${t('signIn')}</button>
    </div>
    ${TEST_LOGIN ? `<div class="card">
      <h3 style="margin-top:0">${esc(t('testAccount'))}</h3>
      <p class="muted">${esc(t('testAccountNote'))}</p>
      <label>${esc(t('testPassword'))}</label>
      <input id="testpw" type="password" autocomplete="off">
      <button class="btn secondary" onclick="testSignIn()">${esc(t('testSignIn'))}</button>
    </div>` : ''}`;
}

// Test account: starts it fresh, then signs in. The reset checks the password on the server.
async function testSignIn() {
  const pw = document.getElementById('testpw').value;
  if (!pw) return setProblem(new Error(t('testPassword')));
  const { error: resetError } = await sb.rpc('reset_test_account', { p_email: TEST_EMAIL, p_password: pw });
  if (resetError) return setProblem(resetError);
  const { error } = await sb.auth.signInWithPassword({ email: TEST_EMAIL, password: pw });
  if (error) return setProblem(error);
  testPassword = pw;
  problem = '';
}

async function signIn() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: APP_URL },
  });
  if (error) setProblem(error);
}

async function signOut() {
  // Leaving the test account clears what was added during the test.
  if (testPassword && session && session.user.email === TEST_EMAIL) {
    try { await sb.rpc('reset_test_account', { p_email: TEST_EMAIL, p_password: testPassword }); } catch (e) {}
  }
  testPassword = null;
  await sb.auth.signOut();
  session = null; hh = null; cache = {}; notice = ''; problem = ''; viewRole = null;
  needsSetup = false; setupData = null; setupStep = 0;
  showIntro = true; tourStep = null; tourList = [];
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
  // Only the tabs this view has, plus Settings.
  tab = (ROLE_TABS[activeRole()].includes(k) || k === 'profile') ? k : 'home';
  notice = ''; problem = '';
  mealForm = false; mealEditId = null; itemForm = false; ruleForm = false; openRecipeId = null; plannerDay = null; plannerRecipeId = null;
  await loadTab();
}

// quiet: the screen already shows what it should (for example, after Cancel), so it is not dimmed or redrawn while the data reloads.
async function loadTab(opts = {}) {
  const quiet = !!opts.quiet;
  // Same screen: keep what is showing, dimmed, until the new data arrives. Different screen: soft placeholder shapes.
  screenBusy = cache.screenTab === tab && !quiet;
  // The greeting and the sheet rising play once each time the app is opened, not on every visit to Home.
  if (tab === 'home' && !introPlayed()) { homeLanded = false; cache.playIntro = true; }
  if (!screenBusy && !quiet) cache.screenHtml = (tab === 'home' && savedHomeHtml()) || skeletonHtml();
  cache.loading = true;
  cache.quietLoad = quiet;
  if (!quiet) render();
  try {
    if (tab === 'home') cache.screenHtml = await screenHome();
    if (tab === 'today') cache.screenHtml = await screenToday();
    if (tab === 'planner') cache.screenHtml = await screenPlanner();
    if (tab === 'kitchen') cache.screenHtml = await screenKitchen();
    if (tab === 'recipes') cache.screenHtml = await screenRecipes();
    if (tab === 'profile') cache.screenHtml = await screenProfile();
  } catch (e) {
    cache.screenHtml = '';
    problem = t('errorPrefix') + (e.message || e);
  }
  cache.loading = false;
  screenBusy = false;
  cache.screenTab = tab;
  // A quiet refresh that changes nothing on Home leaves the drawn screen alone: no rebuild, so nothing replays.
  if (quiet && tab === 'home' && cache.homeSame && cache.screenTab === 'home') { ensureLive(); return; }
  render();
  ensureLive();
}

// ---------------------------------------------------------------
// Live updates: when anyone in the household changes something, the open screen refreshes by itself.
// The app listens to the household's tables (the database only sends rows the user may see) and reloads
// the screen quietly. It waits while someone is typing or a fold is closing, so nothing is lost or jumps.
// ---------------------------------------------------------------
const LIVE_TABLES = ['meals', 'pantry_items', 'recipes', 'recipe_ingredients', 'rules', 'household_members', 'favorites', 'households', 'profiles'];
// Changes to who is in the household, or their role, mean the household itself must be read again before the tab.
const HOUSEHOLD_TABLES = ['household_members', 'households'];
let householdDirty = false;
let liveChannel = null;
let liveHousehold = null;
let liveTimer = null;
let liveVisibilityOn = false;

function ensureLive() {
  if (!hh || !session) return stopLive();
  if (liveChannel && liveHousehold === hh.id) return;
  stopLive();
  liveHousehold = hh.id;
  liveChannel = sb.channel('household-' + hh.id);
  for (const table of LIVE_TABLES) {
    liveChannel.on('postgres_changes', { event: '*', schema: 'public', table }, () => scheduleRefresh(table));
  }
  liveChannel.subscribe();
  if (!liveVisibilityOn) {
    liveVisibilityOn = true;
    // Coming back to the app (from another app, or after the screen was locked) brings it up to date.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRefresh(); });
  }
}
function stopLive() {
  if (liveChannel) { try { sb.removeChannel(liveChannel); } catch (e) {} }
  liveChannel = null;
  liveHousehold = null;
  clearTimeout(liveTimer);
}
function scheduleRefresh(table) {
  if (HOUSEHOLD_TABLES.includes(table)) householdDirty = true;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(refreshNow, 300);
}
async function refreshNow() {
  if (!hh || !session) return;
  const el = document.activeElement;
  if (el && el.matches && el.matches('input, textarea, select')) {
    // Someone is typing: try again once they leave the field.
    el.addEventListener('blur', () => setTimeout(scheduleRefresh, 250), { once: true });
    return;
  }
  // Wait for a load in progress, a fold closing, or the intro on Home to finish.
  if (cache.loading || document.querySelector('.closing') || (tab === 'home' && typeof homeLanded !== 'undefined' && !homeLanded) || (typeof deckBusy !== 'undefined' && deckBusy) || (typeof slideDrag !== 'undefined' && (slideDrag || listDrag))) {
    liveTimer = setTimeout(refreshNow, 200);
    return;
  }
  if (householdDirty) {
    // The role or membership may have changed: read the household again, and move off a tab the new role cannot see.
    householdDirty = false;
    await loadHousehold();
    if (!hh) return render();
    if (!ROLE_TABS[activeRole()].includes(tab) && tab !== 'profile') tab = 'home';
  }
  loadTab({ quiet: true });
}

// Soft placeholder shapes shown while a new screen loads (instead of a blank page with text).
function skeletonHtml() {
  return `<div class="skel-wrap" aria-hidden="true">
    <div class="skel skel-title"></div>
    <div class="skel skel-card"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-line short"></div>
  </div>`;
}

function roleNote() {
  return activeRole() === 'helper' ? t('helperNote') : t('memberNote');
}
