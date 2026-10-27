// Meals tab (the Meal picker): a two-week calendar. Pick a day to see its meals, then add or edit them.
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
const MEAL_SELECT = 'id, meal_date, meal_slot, servings, status, recipe_id, recipes(title_en, title_ar)';
// One meal's row in its slot's list.
function mealRowHtml(m) {
  const title = m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '';
  const statusTag = m.status === 'cooked' ? `<span class="tag">${esc(t('cookedDone'))}</span>`
    : m.status === 'approved' ? `<span class="tag gold">${esc(t('approved'))}</span>`
    : `<span class="tag warn">${esc(t('suggested'))}</span>`;
  let actions = '';
  if (m.status === 'suggested' && can.approve()) actions += `<button class="btn small" onclick="setMealStatus('${m.id}','approved')">${esc(t('approve'))}</button> `;
  if (m.status !== 'cooked' && can.cook()) actions += `<button class="btn small secondary" onclick="setMealStatus('${m.id}','cooked')">${esc(t('markCooked'))}</button> `;
  if (m.status !== 'cooked' && can.suggest()) actions += `<button class="btn small secondary" onclick="editMeal('${m.id}')">${esc(t('editMeal'))}</button> `;
  if (can.deleteMeal()) actions += `<button class="btn small danger" onclick="removeMeal('${m.id}')">${esc(t('deleteMeal'))}</button>`;
  return `<li data-meal="${m.id}"><div class="row"><strong>${esc(title)} · ${m.servings}</strong>${statusTag}</div><div>${actions}</div></li>`;
}

async function screenToday() {
  const today = todayIso();
  const last = isoAddDays(today, CAL_DAYS - 1);
  if (!mealsDay || mealsDay < today || mealsDay > last) mealsDay = today;

  const [meals, recipes, ings, pantry, rules] = await Promise.all([
    sb.from('meals')
      .select('id, meal_date, meal_slot, servings, status, recipe_id, recipes(title_en, title_ar)')
      .eq('household_id', hh.id)
      .gte('meal_date', today)
      .lte('meal_date', last),
    sb.from('recipes').select('id, household_id, created_by, title_en, title_ar, minutes').order('title_en'),
    sb.from('recipe_ingredients').select('id, recipe_id, ingredient_key, name_en, name_ar, quantity, optional'),
    sb.from('pantry_items').select('ingredient_key, level').eq('household_id', hh.id),
    sb.from('rules').select('kind, ingredient_key').eq('household_id', hh.id),
  ]);
  for (const r of [meals, recipes, ings, pantry, rules]) if (r.error) throw r.error;
  cache.meals = meals.data || [];
  cache.recipes = recipes.data || [];
  cache.pickerRecipes = buildPickerRecipes(recipes.data || [], ings.data || [], pantry.data || [], rules.data || []);
  const onDay = cache.meals.filter((m) => m.meal_date === mealsDay);

  // The calendar strip: two weeks from today, with a dot on days that have meals.
  const strip = Array.from({ length: CAL_DAYS }, (_, i) => {
    const iso = isoAddDays(today, i);
    const dt = isoToDate(iso);
    const has = cache.meals.some((m) => m.meal_date === iso);
    return `<button class="daychip ${iso === mealsDay ? 'on' : ''}" onclick="selectDay('${iso}')" aria-label="${esc(niceDay(iso, { weekday: 'long', day: 'numeric', month: 'long' }))}">
      <span class="dc-wd">${esc(dt.toLocaleDateString(t('dateLocale'), { weekday: 'short' }))}</span>
      <span class="dc-num">${dt.getDate()}</span>
      <span class="dc-dot ${has ? 'on' : ''}"></span>
    </button>`;
  }).join('');

  let html = `<div class="daystrip">${strip}</div>
    <h2 class="cal-title">${esc(niceDay(mealsDay, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>`;

  for (const slot of SLOTS) {
    const list = onDay.filter((m) => m.meal_slot === slot);
    html += `<div class="card" data-slot="${slot}"><h3 style="margin-top:0">${esc(t(slot))}</h3>`;
    if (!list.length && mealForm !== slot) html += `<p class="muted empty-note">${esc(t('noMealsSlot'))}</p>`;
    html += '<ul class="clean">';
    for (const m of list) {
      if (mealEditId === m.id) { html += `<li data-meal="${m.id}">${mealFormHtml(m)}</li>`; continue; }
      html += mealRowHtml(m);
    }
    html += '</ul>';
    if (mealForm === slot) html += mealFormHtml(null, slot);
    else html += `<button class="btn small add-slot" onclick="openAddMeal('${slot}')">${esc(t('addMeal'))}</button>`;
    html += '</div>';
  }
  return html;
}

// Recipes for the picker: with how many required ingredients are missing from the kitchen.
// Recipes that contain something the household's rules rule out are left out, as on the Recipes screen.
function buildPickerRecipes(recipes, ings, pantry, rules) {
  const inStock = new Set(pantry.filter((p) => p.level !== 'Finished').map((p) => p.ingredient_key));
  cache.inStockKeys = inStock;
  const donts = new Set(rules.filter((r) => r.kind === 'dont' && r.ingredient_key).map((r) => r.ingredient_key));
  const ingMap = {};
  for (const i of ings) (ingMap[i.recipe_id] = ingMap[i.recipe_id] || []).push(i);
  return recipes
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

function selectDay(iso) { mealsDay = iso; mealForm = false; mealEditId = null; loadTab(); }
// Opening a form puts it in place at once, from the data on screen. The slot's "Add a meal" button is replaced by the
// form, and its empty note is hidden while the form is open. If that isn't possible, the tab redraws quietly.
function openAddMeal(slot) {
  startPicker(null); mealForm = slot; mealEditId = null;
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
  if (!meal) { mealEditId = id; mealForm = false; return loadTab({ quiet: true }); }
  startPicker(meal);
  mealEditId = id; mealForm = false;
  const opened = openFormNow('meal-edit-' + id, () => {
    const li = document.querySelector(`li[data-meal="${id}"]`);
    return li ? { els: [li] } : null;
  }, `<li data-meal="${id}">${mealFormHtml(meal)}</li>`);
  if (!opened) loadTab({ quiet: true });
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
  const reset = () => { mealForm = false; mealEditId = null; notice = t('ok'); problem = ''; };
  const after = () => loadTab({ quiet: true });
  if (mealEditId) return closeFormNow(key, reset, after, mealRowHtml(res.data));
  const card = document.querySelector(`[data-slot="${slot}"]`);
  const list = card && card.querySelector(':scope > ul.clean');
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
