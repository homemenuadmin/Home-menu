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

// The last family Home drawn is kept on this device, so the next open shows it at once while fresh data loads.
// Keyed by household and language, because the markup is written in one language for one household.
function lastHomeKey() {
  return 'homemenu-home-last:' + ((typeof hh !== 'undefined' && hh && hh.id) || 'none') + ':' + (typeof lang !== 'undefined' ? lang : 'en');
}
function savedHomeHtml() {
  try { return localStorage.getItem(lastHomeKey()) || ''; } catch (e) { return ''; }
}
function saveHomeHtml(html) {
  try { localStorage.setItem(lastHomeKey(), html); } catch (e) { /* storage full or blocked: the app simply loads as before */ }
}

async function screenHome() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('greetMorning') : hour < 18 ? t('greetAfternoon') : t('greetEvening');
  const niceDate = new Date().toLocaleDateString(t('dateLocale'), { weekday: 'long', day: 'numeric', month: 'long' });

  if (activeRole() === 'member') {
    let plan = await loadPlan();
    if (await makeSuggestions(plan)) plan = await loadPlan();
    startAiIdeas(plan);
    lastPlan = plan;
    // Only the meal sections that changed are swapped in place; a quiet refresh with no change draws nothing.
    const parts = deckParts(plan);
    const old = cache.homeParts;
    const changed = old ? SLOTS.filter((s) => parts.slots[s] !== old.slots[s]) : [];
    const sameAlerts = !!old && parts.alerts === old.alerts;
    cache.homeParts = parts;
    if (old && sameAlerts && changed.length && cache.quietLoad && cache.screenTab === 'home' && patchDeck(plan, changed)) {
      cache.homeSame = true;
    } else {
      cache.homeSame = !!old && sameAlerts && !changed.length;
    }
    const html = familyHomeHtml(plan, greeting, niceDate);
    saveHomeHtml(html);
    return html;
  }

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
  return cookHomeHtml(meals.data || [], low.data || [], greeting, niceDate);
}

// Family: the greeting, then a sheet with each meal of the day: its ideas to approve, or the approved meal pinned.
// The greeting is in the top bar now, so the family Home is the meals sheet alone. Restock is a pill beside the heading.
function restockPillHtml(plan) {
  const n = plan.low.length;
  if (!n) return '';
  return `<button class="restock-pill" onclick="go('kitchen')">${esc(n + ' · ' + t('needsRestock'))}</button>`;
}

function familyHomeHtml(plan, greeting, niceDate) {
  const sections = deckHtml(plan);
  return `<div class="home-stage" id="homeStage">
    <div class="home-sheet" id="homeSheet">
      <div class="home-meta">
        <h3 class="home-sheet-title">${esc(t('todayMeals'))}</h3>
        ${restockPillHtml(plan)}
      </div>
      ${sections}
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
  mealsDay = todayIso();
  mealEditId = null;
  mealForm = 'dinner';
  await loadTab();
}

// Family Home: sets the greeting and the sheet. On a fresh visit the greeting holds, then the sheet rises over it.
// The greeting can't be scrolled back to: the sheet's top is fixed and only its list scrolls.
function setupHome(intro) {
  intro = false;   // the greeting is in the top bar, so the sheet no longer rises over it
  initDeck();   // the meal cards for the family (home-suggest.js), drawn with the screen
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
  // The timings come from the CSS variables (styles-home.css), so they are set in one place.
  const glideMs = motion('--intro-glide-ms', 1500);
  setTimeout(() => {
    glideSheet(ty0, 0, glideMs, setTy, () => { homeLanded = true; });
  }, motion('--intro-hold-ms', 1900));
  setTimeout(() => sheet.classList.add('revealed'), motion('--intro-sheet-ms', 2500));
}

// Moves the sheet from one height to another with an eased curve. With no time to move in (reduce motion), it jumps to the end.
function glideSheet(from, to, ms, onFrame, done) {
  const ease = (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2);
  if (!ms) { onFrame(to); if (done) done(); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    onFrame(from + (to - from) * ease(k));
    if (k < 1) requestAnimationFrame(step);
    else if (done) done();
  };
  requestAnimationFrame(step);
}
