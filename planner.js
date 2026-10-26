// Planner tab: a week at a glance.
// Family members tap a meal slot to open that day on the Meals tab and fill it in.
// Cooks tap a slot to see that day's meals, open each recipe, and mark meals as cooked.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

let plannerWeek = 0;       // weeks from the current week: 0 is this week
let plannerDay = null;     // cooks: the day open below the week, as YYYY-MM-DD
let plannerRecipeId = null; // cooks: the recipe open on that day, if any

// Monday of the week that is `weeks` weeks from this one.
function plannerWeekStart(weeks) {
  const today = todayIso();
  const dow = isoToDate(today).getDay();          // 0 = Sunday
  const monday = isoAddDays(today, -((dow + 6) % 7));
  return isoAddDays(monday, weeks * 7);
}

async function screenPlanner() {
  const today = todayIso();
  const last = isoAddDays(today, CAL_DAYS - 1);
  const start = plannerWeekStart(plannerWeek);
  const end = isoAddDays(start, 6);
  const cook = activeRole() === 'helper';

  const { data, error } = await sb
    .from('meals')
    .select('id, meal_date, meal_slot, status, servings, recipe_id, recipes(title_en, title_ar)')
    .eq('household_id', hh.id)
    .gte('meal_date', start)
    .lte('meal_date', end);
  if (error) throw error;
  const meals = data || [];

  let html = `<div class="week-nav">
      <button class="btn secondary small" onclick="moveWeek(-1)">${esc(t('prevWeek'))}</button>
      <strong>${esc(niceDay(start, { day: 'numeric', month: 'short' }))} – ${esc(niceDay(end, { day: 'numeric', month: 'short' }))}</strong>
      <button class="btn secondary small" onclick="moveWeek(1)">${esc(t('nextWeek'))}</button>
    </div>
    <p class="muted">${esc(t(cook ? 'plannerHintCook' : 'plannerHint'))}</p>
    <div class="planner">`;

  for (let i = 0; i < 7; i++) {
    const iso = isoAddDays(start, i);
    const isPast = iso < today;
    const isLater = iso > last;
    const open = !isPast && !isLater;
    const dayMeals = meals.filter((m) => m.meal_date === iso);
    html += `<div class="plan-day ${iso === today ? 'today' : ''} ${isPast ? 'past' : ''} ${plannerDay === iso ? 'picked' : ''}">
      <div class="plan-head">
        <span>${esc(niceDay(iso, { weekday: 'long' }))}</span>
        <strong>${esc(niceDay(iso, { day: 'numeric', month: 'short' }))}</strong>
      </div>`;
    for (const slot of SLOTS) {
      const names = dayMeals
        .filter((m) => m.meal_slot === slot)
        .map((m) => (m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : ''))
        .filter(Boolean)
        .join(', ');
      const body = names ? `<span>${esc(names)}</span>` : `<span class="muted">${esc(t('nothingYet'))}</span>`;
      if (!open) html += `<div class="plan-cell off"><small>${esc(t(slot))}</small>${body}</div>`;
      else if (cook) html += `<button class="plan-cell" onclick="openPlannerDay('${iso}')"><small>${esc(t(slot))}</small>${body}</button>`;
      else html += `<button class="plan-cell" onclick="openMealsOn('${iso}')"><small>${esc(t(slot))}</small>${body}</button>`;
    }
    html += '</div>';
  }
  html += '</div>';

  if (cook && plannerDay) html += await plannerDayHtml(plannerDay, meals);
  return html;
}

// Cooks: the meals on one day, with each recipe and a Cooked button.
async function plannerDayHtml(iso, meals) {
  const dayMeals = meals.filter((m) => m.meal_date === iso);
  let html = `<div class="card planner-day-card">
    <div class="row"><h2 style="margin:0">${esc(niceDay(iso, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
      <button class="btn secondary small" onclick="closePlannerDay()">${esc(t('close'))}</button></div>`;

  if (!dayMeals.length) html += `<p class="muted">${esc(t('noMealsDay'))}</p>`;
  for (const slot of SLOTS) {
    for (const m of dayMeals.filter((x) => x.meal_slot === slot)) {
      const title = m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '';
      const statusTag = m.status === 'cooked' ? `<span class="tag">${esc(t('cookedDone'))}</span>`
        : m.status === 'approved' ? `<span class="tag gold">${esc(t('approved'))}</span>`
        : `<span class="tag warn">${esc(t('suggested'))}</span>`;
      const cookedBtn = m.status !== 'cooked'
        ? `<button class="btn small" onclick="setMealStatus('${m.id}','cooked')">${esc(t('markCooked'))}</button>` : '';
      html += `<div class="planner-meal">
        <div class="row"><span><span class="muted">${esc(t(slot))}</span> · <strong>${esc(title)}</strong> · ${m.servings}</span>${statusTag}</div>
        <div class="planner-meal-actions">
          <button class="btn small secondary" onclick="openPlannerRecipe('${m.recipe_id}')">${esc(t('viewRecipe'))}</button>
          ${cookedBtn}
        </div>
      </div>`;
    }
  }
  html += '</div>';

  if (plannerRecipeId) html += await plannerRecipeHtml(plannerRecipeId);
  return html;
}

// The recipe read-only, for cooks: ingredients, with what is in the kitchen, and the steps.
async function plannerRecipeHtml(id) {
  const [rec, ings, pantry] = await Promise.all([
    sb.from('recipes').select('title_en, title_ar, minutes, meal_slot, steps_en, steps_ar').eq('id', id).maybeSingle(),
    sb.from('recipe_ingredients').select('ingredient_key, name_en, name_ar, quantity, optional').eq('recipe_id', id),
    sb.from('pantry_items').select('ingredient_key, level').eq('household_id', hh.id),
  ]);
  for (const r of [rec, ings, pantry]) if (r.error) throw r.error;
  if (!rec.data) return '';
  const r = rec.data;
  const inStock = new Set(pantry.data.filter((p) => p.level !== 'Finished').map((p) => p.ingredient_key));
  let html = `<div class="card">
    <h2 style="margin-top:0">${esc(nameOf(r.title_en, r.title_ar))}</h2>
    <p class="muted">${esc(t(r.meal_slot || 'lunch'))} · ${r.minutes} min</p>
    <h3>${esc(t('ingredients'))}</h3><ul class="clean">`;
  for (const i of ings.data || []) {
    const have = inStock.has(i.ingredient_key);
    const mark = i.optional ? '' : (have ? `<span class="have">✓</span>` : `<span class="lack">${esc(t('missing'))}</span>`);
    html += `<li><div class="row"><span>${esc(nameOf(i.name_en, i.name_ar))}${i.quantity ? ' · ' + esc(i.quantity) : ''}${i.optional ? ' · (' + esc(t('optional')) + ')' : ''}</span>${mark}</div></li>`;
  }
  html += `</ul><h3>${esc(t('steps'))}</h3><p class="step">${esc(nameOf(r.steps_en, r.steps_ar)).replace(/\n/g, '<br>')}</p>
    <button class="btn secondary" onclick="closePlannerRecipe()">${esc(t('back'))}</button></div>`;
  return html;
}

function moveWeek(d) { plannerWeek += d; loadTab(); }

// Cooks: open a day below the week, or close it.
function openPlannerDay(iso) { plannerDay = iso; plannerRecipeId = null; loadTab(); }
function closePlannerDay() { plannerDay = null; plannerRecipeId = null; loadTab(); }
function openPlannerRecipe(id) { plannerRecipeId = id; loadTab(); }
function closePlannerRecipe() { plannerRecipeId = null; loadTab(); }

// Opens the Meals tab on a given day, ready to add or edit meals.
async function openMealsOn(iso) {
  mealsDay = iso;
  mealForm = false;
  mealEditId = null;
  await go('today');
}
