// Home tab. Family members: a greeting that gives way to today's confirmed meals, with a way into the Meal picker.
// Cooks: a short dashboard of today's meals and kitchen alerts.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

let homeLanded = false;   // true once the greeting has given way to the meals sheet on this visit
let homeIntroMem = false; // the intro has played in this page, in case browser storage is unavailable

// The intro plays once per app opening. It's remembered for the browser session, so going back to the app,
// or the page reloading in the background, doesn't repeat it. A fresh open of the app plays it again.
function introPlayed() {
  if (homeIntroMem) return true;
  try { return sessionStorage.getItem('homemenu-intro') === '1'; } catch (e) { return false; }
}
function markIntroPlayed() {
  homeIntroMem = true;
  try { sessionStorage.setItem('homemenu-intro', '1'); } catch (e) {}
}

async function screenHome() {
  const [meals, low] = await Promise.all([
    sb.from('meals')
      .select('id, meal_slot, status, recipes(title_en, title_ar)')
      .eq('household_id', hh.id)
      .eq('meal_date', todayIso()),
    sb.from('pantry_items')
      .select('id, name_en, name_ar, level')
      .eq('household_id', hh.id)
      .in('level', ['Low', 'Finished'])
      .order('name_en'),
  ]);
  if (meals.error) throw meals.error;
  if (low.error) throw low.error;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('greetMorning') : hour < 18 ? t('greetAfternoon') : t('greetEvening');
  const niceDate = new Date().toLocaleDateString(t('dateLocale'), { weekday: 'long', day: 'numeric', month: 'long' });

  if (activeRole() === 'member') return familyHomeHtml(meals.data || [], low.data || [], greeting, niceDate);
  return cookHomeHtml(meals.data || [], low.data || [], greeting, niceDate);
}

// Family: the greeting, then a sheet of today's confirmed meals (approved or cooked).
function familyHomeHtml(meals, low, greeting, niceDate) {
  const confirmed = meals.filter((m) => m.status === 'approved' || m.status === 'cooked');
  let list = '';
  ['breakfast', 'lunch', 'dinner'].forEach((slot) => {
    for (const m of confirmed.filter((x) => x.meal_slot === slot)) {
      const title = m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '';
      const tag = m.status === 'cooked'
        ? `<span class="tag">${esc(t('cookedDone'))}</span>`
        : `<span class="tag gold">${esc(t('approved'))}</span>`;
      list += `<div class="card home-meal" style="--i:${list.split('home-meal').length - 1}">
        <span class="muted">${esc(t(slot))}</span>
        <div class="row"><strong>${esc(title)}</strong>${tag}</div>
      </div>`;
    }
  });
  if (!list) list = `<p class="muted home-empty">${esc(t('noConfirmedToday'))}</p>`;

  const intro = cache.playIntro ? ' intro' : '';
  return `<div class="home-stage${intro}" id="homeStage">
    <div class="home-greet">
      <div class="home-blob"></div>
      <div class="home-greet-inner">
        <div class="home-date">${esc(niceDate)}</div>
        <h1 class="home-hello">${esc(greeting)}</h1>
        <p class="home-note">${esc(roleNote())}</p>
      </div>
      <div class="home-cue">${esc(t('todayMeals'))}</div>
    </div>
    <div class="home-sheet" id="homeSheet">
      <div class="home-grab"></div>
      <h2 class="home-sheet-title">${esc(t('todayMeals'))}</h2>
      ${list}
      <button class="btn home-picker" onclick="go('today')">${esc(t('goToPicker'))}</button>
      <h3 class="home-label">${esc(t('kitchenAlerts'))}</h3>
      ${kitchenAlertsHtml(low)}
      ${installCard('home')}
    </div>
  </div>`;
}

// Cooks: the dashboard as before.
function cookHomeHtml(meals, low, greeting, niceDate) {
  let html = installCard('home') + `
    <div class="card home-hero">
      <div class="muted">${esc(niceDate)}</div>
      <h2 style="margin:4px 0 0">${esc(greeting)}</h2>
      <p class="muted" style="margin:6px 0 0">${esc(roleNote())}</p>
    </div>
    <h3 class="home-label">${esc(t('todayMeals'))}</h3>`;

  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const m = meals.find((x) => x.meal_slot === slot);
    const title = m && m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '';
    html += `<button class="card tile" onclick="go('today')">
      <span class="muted">${esc(t(slot))}</span>
      <strong>${esc(title || t('noMealsSlot'))}</strong>
    </button>`;
  }

  html += `<h3 class="home-label">${esc(t('kitchenAlerts'))}</h3>${kitchenAlertsHtml(low)}`;
  return html;
}

function kitchenAlertsHtml(low) {
  if (!low.length) return `<div class="card"><p class="muted" style="margin:0">${esc(t('nothingLow'))}</p></div>`;
  return `<button class="card tile" onclick="go('kitchen')">
      <span class="muted">${low.length} · ${esc(t('needsRestock'))}</span>
      <ul class="clean home-low">${low.slice(0, 3).map((i) =>
        `<li><strong>${esc(nameOf(i.name_en, i.name_ar))}</strong> <span class="tag warn">${esc(t(i.level))}</span></li>`).join('')}</ul>
    </button>`;
}

// Opens the Meals tab on today, with the add-a-meal form already showing for dinner.
async function homeAddMeal() {
  tab = 'today';
  drawerOpen = false;
  mealsDay = todayIso();
  mealEditId = null;
  mealForm = 'dinner';
  await loadTab();
}

// Family Home: sets the greeting and the sheet. On a fresh visit the greeting holds, then the sheet rises over it.
// The greeting can't be scrolled back to: the sheet's top is fixed and only its list scrolls.
function setupHome(intro) {
  const stage = document.getElementById('homeStage');
  const sheet = document.getElementById('homeSheet');
  if (!stage || !sheet) return;
  cache.playIntro = false;

  const top = stage.getBoundingClientRect().top;
  stage.style.height = Math.max(420, window.innerHeight - top) + 'px';
  const ty0 = stage.clientHeight - 72;   // the sheet rests this far down while the greeting holds
  const setTy = (ty) => {
    sheet.style.transform = `translate3d(0, ${ty.toFixed(1)}px, 0)`;
    const p = Math.min(1, Math.max(0, 1 - ty / ty0));
    stage.style.setProperty('--p', p.toFixed(4));
  };

  if (!intro || homeLanded) {
    homeLanded = true;
    setTy(0);
    sheet.classList.add('revealed');
    return;
  }

  setTy(ty0);
  markIntroPlayed();
  setTimeout(() => {
    glideSheet(ty0, 0, 1500, setTy, () => { homeLanded = true; });
  }, 1900);
  setTimeout(() => sheet.classList.add('revealed'), 2500);
}

// Moves the sheet from one height to another with an eased curve.
function glideSheet(from, to, ms, onFrame, done) {
  const ease = (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2);
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    onFrame(from + (to - from) * ease(k));
    if (k < 1) requestAnimationFrame(step);
    else if (done) done();
  };
  requestAnimationFrame(step);
}
