// Meals tab: a two-week calendar. Pick a day to see its meals, then add or edit them.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// MEALS: calendar of the next two weeks
// ---------------------------------------------------------------
const SLOTS = ['breakfast', 'lunch', 'dinner'];
const CAL_DAYS = 14;
let mealsDay = null;     // the day on show, as YYYY-MM-DD
let mealEditId = null;   // the meal being edited, if any
// mealForm (from core.js): false, or the slot a new meal is being added to.

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

async function screenToday() {
  const today = todayIso();
  const last = isoAddDays(today, CAL_DAYS - 1);
  if (!mealsDay || mealsDay < today || mealsDay > last) mealsDay = today;

  const [meals, recipes] = await Promise.all([
    sb.from('meals')
      .select('id, meal_date, meal_slot, servings, status, recipe_id, recipes(title_en, title_ar)')
      .eq('household_id', hh.id)
      .gte('meal_date', today)
      .lte('meal_date', last),
    sb.from('recipes').select('id, title_en, title_ar').order('title_en'),
  ]);
  if (meals.error) throw meals.error;
  if (recipes.error) throw recipes.error;
  cache.meals = meals.data || [];
  cache.recipes = recipes.data || [];
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
    html += `<div class="card"><h3 style="margin-top:0">${esc(t(slot))}</h3>`;
    if (!list.length && mealForm !== slot) html += `<p class="muted">${esc(t('noMealsSlot'))}</p>`;
    html += '<ul class="clean">';
    for (const m of list) {
      if (mealEditId === m.id) { html += `<li>${mealFormHtml(m)}</li>`; continue; }
      const title = m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '';
      const statusTag = m.status === 'cooked' ? `<span class="tag">${esc(t('cookedDone'))}</span>`
        : m.status === 'approved' ? `<span class="tag gold">${esc(t('approved'))}</span>`
        : `<span class="tag warn">${esc(t('suggested'))}</span>`;
      let actions = '';
      if (m.status === 'suggested' && can.approve()) actions += `<button class="btn small" onclick="setMealStatus('${m.id}','approved')">${esc(t('approve'))}</button> `;
      if (m.status !== 'cooked' && can.cook()) actions += `<button class="btn small secondary" onclick="setMealStatus('${m.id}','cooked')">${esc(t('markCooked'))}</button> `;
      if (m.status !== 'cooked' && can.suggest()) actions += `<button class="btn small secondary" onclick="editMeal('${m.id}')">${esc(t('editMeal'))}</button> `;
      if (can.deleteMeal()) actions += `<button class="btn small danger" onclick="removeMeal('${m.id}')">${esc(t('deleteMeal'))}</button>`;
      html += `<li><div class="row"><strong>${esc(title)} · ${m.servings}</strong>${statusTag}</div><div>${actions}</div></li>`;
    }
    html += '</ul>';
    if (mealForm === slot) html += mealFormHtml(null, slot);
    else html += `<button class="btn small" onclick="openAddMeal('${slot}')">${esc(t('addMeal'))}</button>`;
    html += '</div>';
  }
  return html;
}

// The form for a new meal (existing is null) or for editing one.
function mealFormHtml(existing, slotDefault) {
  const slot = existing ? existing.meal_slot : slotDefault;
  const date = existing ? existing.meal_date : mealsDay;
  const recipeId = existing ? existing.recipe_id : '';
  const servings = existing ? existing.servings : 4;
  const today = todayIso();
  const last = isoAddDays(today, CAL_DAYS - 1);
  const recipes = cache.recipes || [];
  const recipeOptions = recipes.map((r) => `<option value="${r.id}" ${r.id === recipeId ? 'selected' : ''}>${esc(nameOf(r.title_en, r.title_ar))}</option>`).join('');
  return `<div class="meal-form">
      <h3 style="margin-top:0">${esc(existing ? t('editMeal') : t('addMeal'))}</h3>
      ${recipes.length ? '' : `<p class="muted">${esc(t('addRecipeFirst'))}</p>`}
      <label>${esc(t('chooseSlot'))}</label>
      <select id="mslot">${SLOTS.map((s) => `<option value="${s}" ${s === slot ? 'selected' : ''}>${esc(t(s))}</option>`).join('')}</select>
      <label>${esc(t('mealDate'))}</label>
      <input id="mdate" type="date" value="${date}" min="${today}" max="${last}">
      <label>${esc(t('chooseRecipe'))}</label>
      <select id="mrecipe">${recipeOptions}</select>
      <label>${esc(t('servings'))}</label>
      <select id="mservings">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === servings ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
      <button class="btn" onclick="saveMeal()" ${recipes.length ? '' : 'disabled'}>${esc(t('save'))}</button>
      <button class="btn secondary" onclick="cancelMeal()">${esc(t('cancel'))}</button>
    </div>`;
}

function selectDay(iso) { mealsDay = iso; mealForm = false; mealEditId = null; loadTab(); }
function openAddMeal(slot) { mealForm = slot; mealEditId = null; loadTab(); }
function editMeal(id) { mealEditId = id; mealForm = false; loadTab(); }
function cancelMeal() { mealForm = false; mealEditId = null; loadTab(); }

async function saveMeal() {
  const date = document.getElementById('mdate').value;
  const today = todayIso();
  const last = isoAddDays(today, CAL_DAYS - 1);
  if (!date) return setProblem(new Error(t('pickDate')));
  if (date < today || date > last) return setProblem(new Error(t('dateOutsideCalendar')));
  const fields = {
    meal_date: date,
    meal_slot: document.getElementById('mslot').value,
    recipe_id: document.getElementById('mrecipe').value,
    servings: Number(document.getElementById('mservings').value),
  };
  let error;
  if (mealEditId) {
    ({ error } = await sb.from('meals').update(fields).eq('id', mealEditId));
  } else {
    ({ error } = await sb.from('meals').insert({
      ...fields,
      household_id: hh.id,
      status: 'suggested',
      created_by: session.user.id,
    }));
  }
  if (error) return setProblem(error);
  mealsDay = date;
  mealForm = false;
  mealEditId = null;
  setNotice(t('ok'));
  await loadTab();
}

async function setMealStatus(id, status) {
  const { error } = await sb.from('meals').update({ status }).eq('id', id);
  if (error) return setProblem(error);
  await loadTab();
}

async function removeMeal(id) {
  if (!confirm(t('confirmDeleteMeal'))) return;
  const { error } = await sb.from('meals').delete().eq('id', id);
  if (error) return setProblem(error);
  await loadTab();
}
