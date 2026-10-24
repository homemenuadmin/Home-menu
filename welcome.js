// Welcome animation for new people, and the guided tour of the app that follows setup.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// The welcome animation: shown first on every visit for someone who is signed out.
let showIntro = true;
let tourStep = null;     // which tour step is showing; null when the tour is off
let tourList = [];       // the steps of the tour for this person

// ---------------------------------------------------------------
// Welcome: a short boot-up animation, then "Get started"
// ---------------------------------------------------------------
function splitLetters(text) {
  return [...text].map((ch, i) =>
    `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
}

function renderIntro() {
  return `
    <div class="intro">
      <span class="intro-orb o1"></span><span class="intro-orb o2"></span><span class="intro-orb o3"></span>
      <div class="intro-logo" aria-hidden="true">
        <svg viewBox="0 0 80 64">
          <circle class="plate" pathLength="1" cx="40" cy="32" r="17"/>
          <path class="fork" pathLength="1" d="M10 8v12a5 5 0 0 0 10 0V8M15 20v36"/>
          <path class="knife" pathLength="1" d="M70 8c-4 4-5 10-5 15h5v29"/>
        </svg>
      </div>
      <h1 class="intro-title" dir="ltr">${splitLetters(t('appName'))}</h1>
      <p class="intro-sub">${esc(t('welcomeSub'))}</p>
      <button class="btn intro-btn" onclick="startSignIn()">${esc(t('getStarted'))}</button>
    </div>`;
}

// Fades the welcome out, then shows the sign-in screen.
function startSignIn() {
  const el = document.querySelector('.intro');
  const finish = () => { showIntro = false; render(); };
  if (!el) return finish();
  el.classList.add('leaving');
  setTimeout(finish, 350);
}

// ---------------------------------------------------------------
// Guided tour: walks through each part of the app, on the real screens
// ---------------------------------------------------------------
function buildTour() {
  const steps = [
    { tab: 'home', title: 'tourHomeT', text: 'tourHomeB' },
    { tab: 'home', menu: true, title: 'tourMenuT', text: 'tourMenuB' },
    { tab: 'today', title: 'tourTodayT', text: 'tourTodayB' },
    { tab: 'kitchen', title: 'tourKitchenT', text: 'tourKitchenB' },
    { tab: 'recipes', title: 'tourRecipesT', text: 'tourRecipesB' },
    { tab: 'rules', title: 'tourRulesT', text: 'tourRulesB' },
  ];
  steps.push({ tab: 'profile', title: 'tourSettingsT', text: hh.owner ? 'tourSettingsOwnerB' : 'tourSettingsB' });
  steps.push({ tab: 'home', title: 'tourDoneT', text: 'tourDoneB', last: true });
  return steps;
}

// Starts the tour from its first step (after setup, or on a later sign-in if it was never finished).
function startTour() {
  tourList = buildTour();
  tourStep = 0;
  drawerOpen = false;
  tab = 'home';
}

// Shows the current tour step: switches to its screen, and opens the menu if the step is about the menu.
async function showTourStep() {
  const s = tourList[tourStep];
  drawerOpen = !!s.menu;
  notice = ''; problem = '';
  if (s.tab !== tab) {
    tab = s.tab;
    await loadTab();
  } else {
    render();
  }
}

async function tourNext() {
  if (tourStep === null) return;
  if (tourStep >= tourList.length - 1) return finishTour();
  tourStep++;
  await showTourStep();
}

// Ends the tour, whether finished or skipped, and remembers it so it is not shown again.
async function finishTour() {
  tourStep = null;
  tourList = [];
  drawerOpen = false;
  hh.tourDone = true;
  try {
    await sb.from('member_settings').update({ tour_done: true }).eq('user_id', session.user.id);
  } catch (e) { /* the tour simply shows again next time if this fails */ }
  await loadTab();
}

function tourHtml() {
  if (tourStep === null) return '';
  const s = tourList[tourStep];
  const dots = tourList.map((_, i) => `<span class="${i === tourStep ? 'on' : ''}"></span>`).join('');
  return `
    <div class="tour">
      <div class="tour-card" key="${tourStep}">
        <div class="tour-dots">${dots}</div>
        <h2 style="margin:10px 0 4px">${esc(t(s.title))}</h2>
        <p class="muted" style="margin:0">${esc(t(s.text))}</p>
        <div class="tour-actions">
          <button class="btn secondary small" onclick="finishTour()">${esc(t('tourSkip'))}</button>
          <button class="btn small" onclick="tourNext()">${esc(t(s.last ? 'tourFinish' : 'tourNext'))}</button>
        </div>
      </div>
    </div>`;
}
