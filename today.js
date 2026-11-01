// Meals tab (the Meal picker): a month calendar. Pick a day to see its meals in a card below, then add or edit them.
// A new meal is picked from a scrollable list of recipes: tap one to see its details, then add it.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// MEALS: calendar of the next two weeks
// ---------------------------------------------------------------
const SLOTS = ['breakfast', 'lunch', 'dinner'];
const CAL_DAYS = 14;
let mealsDay = null;     // the day on show, as YYYY-MM-DD
let mealEditId = null;   // the meal being edited, if any
// mealForm (from core.js): false, or the slot a new meal is being added to.

// The recipe picker in the meal form: which recipe is open, the servings, the search, and the meal being edited.
let pickerState = { recipeId: null, openId: null, servings: 4, filter: '', mealId: null };
const PICK_COLORS = ['#F9D7B5', '#FCE9A6', '#D6EFD0', '#FDE2CF', '#E4D3F2', '#CDE7F5'];

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// Dates are kept as YYYY-MM-DD text, so they compare correctly as strings.
function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dateToIso(dt) {
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
function isoAddDays(iso, n) {
  const dt = isoToDate(iso);
  dt.setDate(dt.getDate() + n);
  return dateToIso(dt);
}
function niceDay(iso, opts) {
  return isoToDate(iso).toLocaleDateString(t('dateLocale'), opts);
}

// The columns a saved meal is read back with, so it can be shown at once.
const MEAL_SELECT = 'id, meal_date, meal_slot, servings, status, recipe_id, ingredient_changes, recipes(title_en, title_ar, minutes)';
const SLOT_COLORS = { breakfast: ['#FFF1C2', '#7A4E00'], lunch: ['#E0F7F2', '#0F766E'], dinner: ['#EFE7FD', '#6D28D9'] };
const CAL_EXPAND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
const CAL_SHRINK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>';
// The card's state: expanded over the calendar, and the meal whose edit panel is open with its working copy.
let calExpanded = false;
let calDraft = null;   // { id, servings, ings: [{ name, qty, have }] }
// One meal's row in its slot's list.
function mealRowHtml(m) {
  const title = m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '';
  const editable = canPlanDay(m.meal_date);
  const [bg, ink] = SLOT_COLORS[m.meal_slot] || SLOT_COLORS.breakfast;
  const chip = m.status === 'cooked' ? `<span class="tag">${esc(t('cookedDone'))}</span>`
    : m.status === 'approved' ? `<span class="tag gold">${esc(t('approved'))}</span>`
    : `<span class="tag warn">${esc(t('suggested'))}</span>`;
  let acts = '';
  if (editable && m.status === 'suggested' && can.approve()) acts += `<button class="cal-mini ok" onclick="setMealStatus('${m.id}','approved')">${esc(t('approve'))}</button>`;
  if (editable && m.status !== 'cooked' && can.suggest()) acts += `<button class="cal-mini" onclick="editMeal('${m.id}')">${esc(t('editMeal'))}</button>`;
  if (m.status !== 'cooked' && can.cook()) acts += `<button class="cal-mini" onclick="setMealStatus('${m.id}','cooked')">${esc(t('markCooked'))}</button>`;
  if (editable && can.deleteMeal()) acts += `<button class="cal-mini danger" onclick="removeMeal('${m.id}')">${esc(t('deleteMeal'))}</button>`;
  const open = mealEditId === m.id && calDraft && calDraft.id === m.id;
  const mins = m.recipes && m.recipes.minutes ? `${m.recipes.minutes} ${esc(t('calMinutes'))} · ` : '';
  return `<li data-meal="${m.id}"><div class="cal-item-row">
      <span class="cal-thumb" style="background:${bg};color:${ink}" aria-hidden="true">${esc((title || '?').trim().charAt(0).toUpperCase())}</span>
      <div class="cal-txt"><strong>${esc(title)}</strong><small>${mins}${m.servings} ${esc(t('calServings'))}</small>
        <div class="cal-acts${open ? ' quiet' : ''}">${acts}</div></div>${chip}
    </div>${open ? calEditPanelHtml(m, false) : ''}</li>`;
}

// The Meals tab's calendar state: whether the day's card is open, and the meal slot it shows.
let calOpen = true;
let calSlot = 'breakfast';
let calTimer = null;          // the highlight's move, once it has faded out
const CAL_PICK_MS = 240;      // the highlight fades out before it moves; the card waits for the same time

// Meals can be planned on today and the next two weeks. Other days are shown, but not changed.
function canPlanDay(iso) {
  const today = todayIso();
  return iso >= today && iso <= isoAddDays(today, CAL_DAYS - 1);
}
function monthStartOf(iso) { return iso.slice(0, 7) + '-01'; }
function monthEndOf(iso) {
  const d = isoToDate(monthStartOf(iso));
  return dateToIso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

async function screenToday() {
  const today = todayIso();
  if (!mealsDay) mealsDay = today;
  // The month on show, plus the days either side that fill its first and last weeks.
  const monthFirst = monthStartOf(mealsDay);
  const monthLast = monthEndOf(mealsDay);
  const dow0 = isoToDate(monthFirst).getDay();
  const cells = Math.ceil((dow0 + isoToDate(monthLast).getDate()) / 7) * 7;
  const gridStart = isoAddDays(monthFirst, -dow0);
  const gridEnd = isoAddDays(gridStart, cells - 1);

  const [meals, recipes, ings, pantry, rules] = await Promise.all([
    sb.from('meals')
      .select(MEAL_SELECT)
      .eq('household_id', hh.id)
      .gte('meal_date', gridStart)
      .lte('meal_date', gridEnd),
    sb.from('recipes').select('id, household_id, created_by, copied_from, title_en, title_ar, minutes, meal_slot, source').order('title_en'),
    sb.from('recipe_ingredients').select('id, recipe_id, ingredient_key, name_en, name_ar, quantity, optional'),
    sb.from('pantry_items').select('ingredient_key, level').eq('household_id', hh.id),
    sb.from('rules').select('kind, ingredient_key').eq('household_id', hh.id),
  ]);
  for (const r of [meals, recipes, ings, pantry, rules]) if (r.error) throw r.error;
  cache.meals = meals.data || [];
  cache.recipes = recipes.data || [];
  cache.pickerRecipes = buildPickerRecipes(recipes.data || [], ings.data || [], pantry.data || [], rules.data || []);
  cache.ingsByRecipe = {};
  for (const i of ings.data || []) (cache.ingsByRecipe[i.recipe_id] = cache.ingsByRecipe[i.recipe_id] || []).push(i);

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    `<div>${esc(niceDay(isoAddDays(gridStart, i), { weekday: 'short' }))}</div>`).join('');
  let days = '';
  for (let i = 0; i < cells; i++) {
    const iso = isoAddDays(gridStart, i);
    const dayMeals = cache.meals.filter((m) => m.meal_date === iso);
    // One dot per slot with a meal; a dot is faded while the meal is only suggested.
    const dots = SLOTS.filter((s) => dayMeals.some((m) => m.meal_slot === s)).map((s) => {
      const approved = dayMeals.some((m) => m.meal_slot === s && m.status !== 'suggested');
      return `<i class="cal-dot cal-dot-${s}${approved ? '' : ' sug'}"></i>`;
    }).join('');
    const out = iso < monthFirst || iso > monthLast;
    days += `<button class="cal-day${out ? ' out' : ''}${iso === today ? ' today' : ''}" data-cal="${iso}" onclick="calPick('${iso}')" aria-label="${esc(niceDay(iso, { weekday: 'long', day: 'numeric', month: 'long' }))}">
      <span class="n">${isoToDate(iso).getDate()}</span><span class="cal-marks">${dots}</span></button>`;
  }

  let html = `<div class="cal-legend">${SLOTS.map((s) => `<span><i class="cal-dot cal-dot-${s}"></i>${esc(t(s))}</span>`).join('')}</div>
    <div class="cal-stage"><div class="cal" id="calCal">
      <div class="cal-top">
        <button class="cal-nav" onclick="calMove(-1)" aria-label="${esc(t('prevMonth'))}">&#8249;</button>
        <strong>${esc(niceDay(monthFirst, { month: 'long', year: 'numeric' }))}</strong>
        <button class="cal-nav" onclick="calMove(1)" aria-label="${esc(t('nextMonth'))}">&#8250;</button>
      </div>
      <div class="cal-week">${weekdays}</div>
      <div class="cal-grid" id="calGrid"><span class="cal-sel" id="calSel" aria-hidden="true"></span>${days}</div>
    </div>`;
  if (calOpen) html += calDrawerHtml(true);
  return html + '</div>';
}

// The title and count of the day's card.
function calTitleText() { return niceDay(mealsDay, { weekday: 'long', day: 'numeric', month: 'long' }); }
function calCountText() {
  const dayMeals = (cache.meals || []).filter((m) => m.meal_date === mealsDay);
  const planned = SLOTS.filter((s) => dayMeals.some((m) => m.meal_slot === s)).length;
  const approved = SLOTS.filter((s) => dayMeals.some((m) => m.meal_slot === s && m.status !== 'suggested')).length;
  return `${approved} ${t('calApprovedOf')} · ${planned} ${t('calPlanned')}`;
}

// The card under the calendar: the day, its count, the slot switch, and the chosen slot's meals.
function calDrawerHtml(withEnter) {
  const cls = `${withEnter ? foldEnter('cal-sheet') : ''}${calExpanded ? ' expanded' : ''}${mealForm ? ' form-open' : ''}`;
  return `<div class="fold cal-drawer${cls}" data-fold="cal-sheet" id="calDrawer"><div class="cal-sheet">
    <div class="cal-head"><div><h2 id="calTitle">${esc(calTitleText())}</h2><small id="calCount">${esc(calCountText())}</small></div>
      <button class="icon-btn cal-close" id="calExpandBtn" onclick="calToggleExpand()" aria-label="${esc(t(calExpanded ? 'calShrink' : 'calExpand'))}">${calExpanded ? CAL_SHRINK : CAL_EXPAND}</button></div>
    <div class="seg cal-seg"><span class="seg-ind" aria-hidden="true"></span>${SLOTS.map((s) =>
      `<button class="${s === calSlot ? 'on' : ''}" onclick="calSlotTap(this, '${s}')">${esc(t(s))}</button>`).join('')}</div>
    <div id="calBody">${calBodyHtml()}</div>
  </div></div>`;
}

// The chosen slot on the chosen day: its meals, then the add button, or why the day cannot be changed.
function calBodyHtml() {
  const onDay = (cache.meals || []).filter((m) => m.meal_date === mealsDay && m.meal_slot === calSlot);
  let html = `<div class="cal-slot" data-slot="${calSlot}">`;
  if (!onDay.length && mealForm !== calSlot) html += `<p class="muted empty-note">${esc(t('noMealsSlot'))}</p>`;
  // The meals scroll in a short window; a fade at the bottom shows there is more to see.
  html += '<div class="cal-items-wrap"><div class="cal-items"><ul class="cal-list">' + onDay.map(mealRowHtml).join('') + '</ul></div></div>';
  if (mealForm === calSlot) html += mealFormHtml(null, calSlot);
  else if (canPlanDay(mealsDay)) html += `<button class="cal-add add-slot" onclick="openAddMeal('${calSlot}')">+ ${esc(t('addMeal'))}</button>`;
  else html += `<p class="muted">${esc(t(mealsDay < todayIso() ? 'calPastDay' : 'calFarDay'))}</p>`;
  return html + '</div>';
}

// Moves the highlight to the chosen day. With animate, it fades out first and then moves and fades in.
function calPlaceSel(animate) {
  const cal = document.getElementById('calCal');
  if (cal) cal.parentElement.style.setProperty('--cal-h', cal.offsetHeight + 'px');
  const ring = document.getElementById('calSel');
  const grid = document.getElementById('calGrid');
  if (!ring || !grid) return;
  const cell = calOpen && mealsDay && grid.querySelector(`[data-cal="${mealsDay}"]`);
  clearTimeout(calTimer);
  if (!cell) { ring.classList.remove('on'); return; }
  const move = () => {
    ring.style.transition = 'none';
    ring.style.left = cell.offsetLeft + 'px';
    ring.style.top = cell.offsetTop + 'px';
    ring.style.width = cell.offsetWidth + 'px';
    ring.style.height = cell.offsetHeight + 'px';
    void ring.offsetWidth;
    ring.style.transition = '';
    ring.classList.add('on');
  };
  if (animate && ring.classList.contains('on')) {
    ring.classList.remove('on');
    calTimer = setTimeout(move, CAL_PICK_MS);
  } else move();
}

// Plays the slide on an element: dir 'r' for a later day (from the right), 'l' for an earlier one.
function calSwap(el, dir) {
  el.classList.remove('cal-swap-r', 'cal-swap-l');
  void el.offsetWidth;
  el.classList.add(dir === 'r' ? 'cal-swap-r' : 'cal-swap-l');
}

// Redraws the card's text for the chosen day, with the slide from the side the new day is on.
function calFill(dir) {
  const title = document.getElementById('calTitle');
  const body = document.getElementById('calBody');
  if (!title || !body) return;
  title.textContent = calTitleText();
  document.getElementById('calCount').textContent = calCountText();
  body.innerHTML = calBodyHtml();
  if (dir) { calSwap(title.closest('.cal-head'), dir); calSwap(body, dir); }
  syncScreenHtml();
}

// Tapping a day opens its card, or moves the card to that day. Tapping the open day again closes the card.
function calPick(iso) {
  if (calOpen && iso === mealsDay) return calClose();
  const prev = mealsDay;
  mealsDay = iso; mealForm = false; mealEditId = null; calOpen = true;
  // A day in another month, or a calendar not on screen yet, is drawn by a quiet reload.
  if (!document.querySelector(`#calGrid [data-cal="${iso}"]`)) return loadTab({ quiet: true });
  const drawer = document.querySelector('[data-fold="cal-sheet"]');
  if (!drawer || drawer.classList.contains('closing')) {
    // The card was closed: it drops out from under the calendar, and the highlight fades in on the day.
    if (drawer) drawer.remove();
    document.querySelector('.cal').insertAdjacentHTML('afterend', calDrawerHtml(true));
    calPlaceSel(true);
    return syncScreenHtml();
  }
  // The highlight fades out and moves; the card waits for the same time, then slides in with the new day.
  const dir = iso > prev ? 'r' : 'l';
  calPlaceSel(true);
  setTimeout(() => calFill(dir), CAL_PICK_MS);
}

// Closes the card: the highlight fades away, and the card folds back under the calendar.
function calClose() {
  calOpen = false; calExpanded = false; mealForm = false; mealEditId = null; closeEditNow();
  calPlaceSel(false);
  const drawer = document.querySelector('[data-fold="cal-sheet"]');
  if (!drawer || drawer.classList.contains('closing')) return syncScreenHtml();
  foldClose('cal-sheet', () => { drawer.remove(); syncScreenHtml(); });
}

// Shows another slot in the card. The pill slides to it; the card's meals change under it.
function calSlotTap(btn, slot) {
  if (calSlot === slot) return;
  segTap(btn);
  calSlot = slot; mealForm = false; mealEditId = null;
  const seg = btn.parentElement;
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  segPlay(seg);
  document.getElementById('calBody').innerHTML = calBodyHtml();
  syncScreenHtml();
}

// Moves the calendar a month. The card closes, as the days it showed are no longer on screen.
function calMove(d) {
  const f = isoToDate(monthStartOf(mealsDay));
  mealsDay = dateToIso(new Date(f.getFullYear(), f.getMonth() + d, 1));
  calOpen = false; mealForm = false; mealEditId = null;
  loadTab({ quiet: true });
}

// Recipes for the picker: with how many required ingredients are missing from the kitchen.
// Recipes that contain something the household's rules rule out are left out, as on the Recipes screen.
function buildPickerRecipes(recipes, ings, pantry, rules) {
  const inStock = new Set(pantry.filter((p) => p.level !== 'Finished').map((p) => p.ingredient_key));
  cache.inStockKeys = inStock;
  const donts = new Set(rules.filter((r) => r.kind === 'dont' && r.ingredient_key).map((r) => r.ingredient_key));
  const ingMap = {};
  for (const i of ings) (ingMap[i.recipe_id] = ingMap[i.recipe_id] || []).push(i);
  // A shared recipe is left out once the household has its own copy, which stands in for it.
  const copied = new Set(recipes.map((r) => r.copied_from).filter(Boolean));
  return recipes
    .filter((r) => !(r.household_id === null && copied.has(r.id)))
    .map((r) => {
      const list = ingMap[r.id] || [];
      const missing = list.filter((i) => !i.optional && !inStock.has(i.ingredient_key)).length;
      return {
        id: r.id,
        household_id: r.household_id,
        created_by: r.created_by,
        title_en: r.title_en,
        title_ar: r.title_ar,
        minutes: r.minutes,
        meal_slot: r.meal_slot,
        source: r.source,
        missing,
        ready: missing === 0,
        hidden: list.some((i) => donts.has(i.ingredient_key)),
        ings: list,
      };
    })
    .filter((r) => !r.hidden);
}

// Sets the picker for a new meal, or for a meal being edited.
function startPicker(existing) {
  pickerState = {
    recipeId: existing ? existing.recipe_id : null,
    openId: existing ? existing.recipe_id : null,
    servings: existing ? existing.servings : 4,
    filter: '',
    mealId: existing ? existing.id : null,
  };
}

// The form for a new meal (existing is null) or for editing one. The slot comes from the card it sits in.
function mealFormHtml(existing, slotDefault) {
  const slot = existing ? existing.meal_slot : slotDefault;
  const hasRecipes = (cache.pickerRecipes || []).length > 0;
  const key = existing ? 'meal-edit-' + existing.id : 'meal-' + slot;
  return `<div class="fold${foldEnter(key)}" data-fold="${key}"><div class="meal-form">
      <h3 style="margin-top:0">${esc(existing ? t('editMeal') : t('addMeal'))} · ${esc(t(slot))}</h3>
      ${hasRecipes ? '' : `<p class="muted">${esc(t('addRecipeFirst'))}</p>`}
      <input class="picker-search" type="search" value="${esc(pickerState.filter)}" placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}" oninput="filterPicker(this.value)">
      <div class="picker-list" id="pickerList" data-keep-scroll>${pickerListHtml()}</div>
      <button class="btn secondary" onclick="cancelMeal()">${esc(t('cancel'))}</button>
    </div></div>`;
}

function pickerListHtml() {
  const q = (pickerState.filter || '').trim().toLowerCase();
  const items = (cache.pickerRecipes || []).filter((r) =>
    !q || (r.title_en || '').toLowerCase().includes(q) || (r.title_ar || '').includes(q));
  if (!items.length) return `<p class="muted">${esc(t('noRecipes'))}</p>`;
  return items.map(pickerRowHtml).join('');
}

function pickerRowHtml(r) {
  const open = pickerState.openId === r.id;
  const name = nameOf(r.title_en, r.title_ar);
  const initial = esc((name || '?').trim().charAt(0).toUpperCase());
  const color = PICK_COLORS[[...r.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % PICK_COLORS.length];
  const tag = r.ready
    ? `<span class="tag">${esc(t('ready'))}</span>`
    : `<span class="tag warn">${esc(t('missing'))} ${r.missing}</span>`;
  const ings = r.ings.map((i, idx) => ingLiHtml(i, idx)).join('');
  return `<div class="pick-item ${open ? 'open' : ''}" data-pick="${r.id}">
      <button class="pick-row" onclick="togglePick('${r.id}')" aria-expanded="${open}">
        <span class="pick-thumb" style="background:${color}" aria-hidden="true">${initial}</span>
        <span class="pick-meta"><strong>${esc(name)}</strong><small>${r.minutes} min</small><span class="rstatus">${tag}</span></span>
        <span class="pick-chev" aria-hidden="true">⌄</span>
      </button>
      <div class="pick-details"><div class="pick-details-inner">
        ${ingHeadHtml(r)}
        <ul class="clean pick-ings">${ings}</ul>
        ${ingAddHtml(r)}
        <div class="pick-actions">
          <div class="stepper">
            <button type="button" onclick="pickServings(-1)">−</button>
            <output>${pickerState.servings}</output>
            <button type="button" onclick="pickServings(1)">+</button>
          </div>
          <button class="btn" onclick="chooseRecipe('${r.id}')">${esc(pickerState.mealId ? t('save') : t('addMeal'))}</button>
        </div>
        <div class="pick-cancel"><button class="btn secondary" onclick="closePick()">${esc(t('cancel'))}</button></div>
      </div></div>
    </div>`;
}

// Re-draws only the list, so the search box keeps its place and the open recipe stays open.
function rerenderPicker() {
  const el = document.getElementById('pickerList');
  if (el) el.innerHTML = pickerListHtml();
}
// Opening and closing only change classes on the cards that already exist, so the browser can animate between states.
// Rebuilding the list here would throw that away.
function paintPicks() {
  document.querySelectorAll('[data-pick]').forEach((el) => {
    const open = el.dataset.pick === pickerState.openId;
    el.classList.toggle('open', open);
    if (!open) toggleIngEdit(el, false);
    el.querySelector('.pick-row').setAttribute('aria-expanded', String(open));
  });
}
// Once an opened card has grown, scroll the list just enough to show its bottom edge.
function revealPick() {
  const list = document.getElementById('pickerList');
  const el = document.querySelector('[data-pick].open');
  if (!list || !el) return;
  const box = list.getBoundingClientRect();
  const card = el.getBoundingClientRect();
  if (card.bottom > box.bottom) list.scrollBy({ top: card.bottom - box.bottom + 10, behavior: 'smooth' });
}
function togglePick(id) {
  pickerState.openId = pickerState.openId === id ? null : id;
  paintPicks();
  if (pickerState.openId) setTimeout(revealPick, motion('--pick-open', 460));
}
function closePick() { pickerState.openId = null; paintPicks(); }
function pickServings(d) {
  pickerState.servings = Math.min(12, Math.max(1, pickerState.servings + d));
  document.querySelectorAll('.pick-item output').forEach((o) => { o.textContent = pickerState.servings; });
}
function filterPicker(v) { pickerState.filter = v; rerenderPicker(); }
function chooseRecipe(id) { pickerState.recipeId = id; saveMeal(); }

// Opening a form puts it in place at once, from the data on screen. The slot's "Add a meal" button is replaced by the
// form, and its empty note is hidden while the form is open. If that isn't possible, the tab redraws quietly.
function openAddMeal(slot) {
  startPicker(null); mealForm = slot; mealEditId = null;
  // The card grows over the calendar, and the meal menu comes up as it does.
  closeEditNow();
  calSetExpanded(true);
  const drawer = document.getElementById('calDrawer');
  if (drawer) drawer.classList.add('form-open');
  const opened = openFormNow('meal-' + slot, () => {
    const card = document.querySelector(`[data-slot="${slot}"]`);
    const btn = card && card.querySelector('.add-slot');
    if (!btn) return null;
    return { els: [btn], hide: [card.querySelector('.empty-note')].filter(Boolean) };
  }, mealFormHtml(null, slot));
  if (!opened) loadTab({ quiet: true });
}
function editMeal(id) {
  const meal = (cache.meals || []).find((m) => m.id === id);
  if (!meal) return loadTab({ quiet: true });
  closeEditNow();
  // The working copy: the meal's own ingredients if they were changed, otherwise the recipe's.
  calDraft = {
    id, servings: meal.servings,
    ings: (meal.ingredient_changes || recipeIngsFor(meal)).map((g) => ({ ...g })),
  };
  mealEditId = id; mealForm = false;
  const li = document.querySelector(`li[data-meal="${id}"]`);
  if (!li) return loadTab({ quiet: true });
  li.querySelector('.cal-acts').classList.add('quiet');   // hidden, but keeping its place, so the row does not change size
  li.insertAdjacentHTML('beforeend', calEditPanelHtml(meal, true));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const w = li.querySelector('.cal-exp-wrap');
    if (w) w.classList.remove('shut');
  }));
  syncScreenHtml();
}
// The key of the meal form that is open: 'meal-<slot>' for a new meal, 'meal-edit-<id>' for an edit, or ''.
function mealFormKey() {
  if (mealEditId) return 'meal-edit-' + mealEditId;
  return typeof mealForm === 'string' && mealForm ? 'meal-' + mealForm : '';
}
// Cancel folds the form away and puts the slot's button and note back, with no wait for the network.
function cancelMeal() {
  const key = mealFormKey();
  if (!key) { mealForm = false; mealEditId = null; return loadTab({ quiet: true }); }
  // The card shrinks back as the menu folds away.
  calSetExpanded(false);
  const drawer = document.getElementById('calDrawer');
  if (drawer) drawer.classList.remove('form-open');
  closeFormNow(key, () => { mealForm = false; mealEditId = null; });
}

async function saveMeal() {
  // The meal goes on the day chosen at the top of the screen.
  const date = mealsDay;
  const today = todayIso();
  const last = isoAddDays(today, CAL_DAYS - 1);
  if (!date || date < today || date > last) return setProblem(new Error(t('dateOutsideCalendar')));
  if (!pickerState.recipeId) return setProblem(new Error(t('pickRecipeFirst')));
  // A new meal takes the slot of the card it was opened from; an edited meal keeps its slot.
  const slot = mealEditId ? (cache.meals.find((m) => m.id === mealEditId) || {}).meal_slot : mealForm;
  const fields = {
    ingredient_changes: null,   // a new recipe or day starts from the recipe's own ingredients
    meal_date: date,
    meal_slot: slot,
    recipe_id: pickerState.recipeId,
    servings: pickerState.servings,
  };
  let res;
  if (mealEditId) res = await sb.from('meals').update(fields).eq('id', mealEditId).select(MEAL_SELECT).single();
  else res = await sb.from('meals').insert({
    ...fields,
    household_id: hh.id,
    status: 'suggested',
    created_by: session.user.id,
  }).select(MEAL_SELECT).single();
  if (res.error) return setProblem(res.error);
  mealsDay = date;
  // The saved meal shows at once: an edited meal takes the place of its row, a new one joins its slot's list.
  // The form then folds closed, and the tab reloads quietly to confirm what was saved.
  const key = mealFormKey();
  const reset = () => { mealForm = false; mealEditId = null; calSetExpanded(false); notice = t('ok'); problem = ''; };
  const after = () => loadTab({ quiet: true });
  if (mealEditId) return closeFormNow(key, reset, after, mealRowHtml(res.data));
  const card = document.querySelector(`[data-slot="${slot}"]`);
  const list = card && card.querySelector(':scope > ul.cal-list');
  if (list) {
    list.insertAdjacentHTML('beforeend', mealRowHtml(res.data));
    const note = card.querySelector('.empty-note');
    if (note) note.remove();
  }
  closeFormNow(key, reset, after);
}

async function setMealStatus(id, status) {
  const { error } = await sb.from('meals').update({ status }).eq('id', id);
  if (error) return setProblem(error);
  await loadTab({ quiet: true });
}

async function removeMeal(id) {
  if (!confirm(t('confirmDeleteMeal'))) return;
  const { error } = await sb.from('meals').delete().eq('id', id);
  if (error) return setProblem(error);
  await loadTab({ quiet: true });
}

// ---------------------------------------------------------------
// The card: expanding over the calendar, and the edit panel for a meal
// ---------------------------------------------------------------
function calSetExpanded(on) {
  calExpanded = on;
  const drawer = document.getElementById('calDrawer');
  if (drawer) drawer.classList.toggle('expanded', on);
  const b = document.getElementById('calExpandBtn');
  if (b) { b.innerHTML = on ? CAL_SHRINK : CAL_EXPAND; b.setAttribute('aria-label', t(on ? 'calShrink' : 'calExpand')); }
}
function calToggleExpand() { calSetExpanded(!calExpanded); }

// The recipe's own ingredients, in the shape the edit panel uses.
function recipeIngsFor(meal) {
  const inStock = cache.inStockKeys || new Set();
  return (cache.ingsByRecipe || {})[meal.recipe_id] ? cache.ingsByRecipe[meal.recipe_id].map((i) => ({
    name: nameOf(i.name_en, i.name_ar), qty: i.quantity || '', have: inStock.has(i.ingredient_key),
  })) : [];
}

// The edit panel for a meal. It is the editing menu, as on the Recipes tab: a stepper and × on each ingredient,
// and "Add an ingredient" at the bottom. Done saves the meal; the servings, Change meal and Cancel sit below.
function calEditPanelHtml(meal, shut) {
  const d = calDraft;
  const rows = d.ings.map((g, i) => {
    const stepper = parseAmount(g.qty)
      ? `<span class="ing-step"><button type="button" onclick="calIngStep(${i}, -1)" aria-label="−">−</button>
          <span class="ing-amt">${esc(g.qty)}</span><button type="button" onclick="calIngStep(${i}, 1)" aria-label="+">+</button></span>`
      : `<span class="ing-amt">${esc(g.qty || '')}</span>`;
    return `<li style="--i:${i}"><div class="ing-line"><span class="ing-name">${esc(g.name)}</span><span class="ing-mark"></span>
      <span class="ing-tools">${stepper}<button type="button" class="ing-x" onclick="calIngRemove(${i})" aria-label="${esc(t('removeIngredient'))} ${esc(g.name)}">×</button></span></div></li>`;
  }).join('');
  return `<div class="cal-exp-wrap${shut ? ' shut' : ''}"><div class="cal-exp"><div class="cal-exp-in edit-menu editing">
    <div class="ings-head"><h3>${esc(t('ingredients'))}</h3>
      <button type="button" class="pick-edit-btn" onclick="calEditSave('${meal.id}')"><span class="when-edit">${esc(t('done'))}</span></button></div>
    <ul class="cal-ings">${rows}</ul>
    <div class="ing-add-wrap"><div class="ing-add">
      <input class="ing-new-name" id="calNewName" placeholder="${esc(t('addIngredient'))}" aria-label="${esc(t('addIngredient'))}">
      <input class="ing-new-qty" id="calNewQty" placeholder="${esc(t('ingAmount'))}" aria-label="${esc(t('ingAmount'))}">
      <button type="button" class="ing-add-btn" onclick="calIngAdd()">${esc(t('ingAdd'))}</button>
    </div></div>
    <div class="cal-exp-foot">
      <div class="cal-stepper"><span>${esc(t('calServings'))}</span><button type="button" onclick="calServ(-1)" aria-label="−">&minus;</button><output id="calServOut">${d.servings}</output><button type="button" onclick="calServ(1)" aria-label="+">+</button></div>
      <div class="cal-exp-btns"><button type="button" class="cal-mini" onclick="calChangeMeal('${meal.id}')">${esc(t('calChangeMeal'))}</button>
        <button type="button" class="cal-mini" onclick="calEditCancel()">${esc(t('cancel'))}</button></div>
    </div>
  </div></div></div>`;
}

// Redraws the open panel from the working copy, without replaying its entrance.
function redrawEditPanel() {
  const wrap = document.querySelector(`li[data-meal="${calDraft.id}"] .cal-exp-wrap`);
  const meal = (cache.meals || []).find((m) => m.id === calDraft.id);
  if (wrap && meal) wrap.outerHTML = calEditPanelHtml(meal, false);
  syncScreenHtml();
}
// A stepper tap moves the amount, as on the Recipes tab. Nothing is saved until Done.
function calIngStep(i, dir) {
  const g = calDraft.ings[i];
  const p = parseAmount(g.qty);
  if (!p) return;
  const step = stepFor(p.unit);
  g.qty = fmtAmount(Math.max(step, +(p.n + dir * step).toFixed(2)), p.unit);
  const amt = document.querySelectorAll('.cal-ings > li')[i];
  if (amt) amt.querySelector('.ing-amt').textContent = g.qty;
}
function calIngRemove(i) { calDraft.ings.splice(i, 1); redrawEditPanel(); }
function calIngAdd() {
  const name = document.getElementById('calNewName');
  const qty = document.getElementById('calNewQty');
  if (!name) return;
  const n = name.value.trim();
  if (!n) return name.focus();
  calDraft.ings.push({ name: n, qty: qty.value.trim(), have: false });
  redrawEditPanel();
}
function calServ(d) {
  calDraft.servings = Math.min(12, Math.max(1, calDraft.servings + d));
  const out = document.getElementById('calServOut');
  if (out) out.textContent = calDraft.servings;
}

// Folds the open panel away (after the shrink) and puts the meal's row back as it was.
function closeEditNow() {
  if (!calDraft) { mealEditId = null; return; }
  const li = document.querySelector(`li[data-meal="${calDraft.id}"]`);
  calDraft = null; mealEditId = null;
  if (li) {
    const panel = li.querySelector('.cal-exp-wrap');
    if (panel) panel.remove();
    const acts = li.querySelector('.cal-acts');
    if (acts) { acts.classList.remove('quiet'); acts.classList.add('fade-in'); }
  }
  syncScreenHtml();
}
function calEditCancel() {
  if (!calDraft) return;
  const wrap = document.querySelector(`li[data-meal="${calDraft.id}"] .cal-exp-wrap`);
  if (!wrap || wrap.classList.contains('shut')) return;
  wrap.classList.add('shut');
  setTimeout(closeEditNow, motion('--pick-close', 400));
}
// Save: the servings and the ingredient changes go to the meal, then the tab reloads quietly.
async function calEditSave(id) {
  if (!calDraft || calDraft.id !== id) return;
  const wrap = document.querySelector(`li[data-meal="${id}"] .cal-exp-wrap`);
  if (wrap) wrap.classList.add('shut');
  const { data, error } = await sb.from('meals')
    .update({ servings: calDraft.servings, ingredient_changes: calDraft.ings })
    .eq('id', id).select(MEAL_SELECT).single();
  if (error) {
    if (wrap) wrap.classList.remove('shut');
    return setProblem(error);
  }
  cache.meals = (cache.meals || []).map((m) => (m.id === id ? data : m));
  setTimeout(() => { closeEditNow(); loadTab({ quiet: true }); }, motion('--pick-close', 400));
}
// "Change meal" opens the existing picker, to choose a different recipe for this meal.
function calChangeMeal(id) {
  const meal = (cache.meals || []).find((m) => m.id === id);
  if (!meal) return;
  closeEditNow();
  startPicker(meal);
  mealEditId = id; mealForm = false;
  const opened = openFormNow('meal-edit-' + id, () => {
    const li = document.querySelector(`li[data-meal="${id}"]`);
    return li ? { els: [li] } : null;
  }, `<li data-meal="${id}">${mealFormHtml(meal)}</li>`);
  if (!opened) loadTab({ quiet: true });
}

// The fade at the bottom of the meal window shows only while there is more below.
function calUpdateMore() {
  document.querySelectorAll('.cal-items').forEach((el) => {
    const wrap = el.parentElement;
    const more = el.scrollHeight - el.clientHeight - el.scrollTop > 4;
    wrap.classList.toggle('more', el.scrollHeight > el.clientHeight + 4 && more);
  });
}
document.addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('cal-items')) calUpdateMore(); }, true);
new MutationObserver(() => calUpdateMore()).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
