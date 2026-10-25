// Planner tab: a week at a glance. Tap a meal slot to open that day on the Meals tab and fill it in.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

let plannerWeek = 0;   // weeks from the current week: 0 is this week

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

  const { data, error } = await sb
    .from('meals')
    .select('id, meal_date, meal_slot, recipes(title_en, title_ar)')
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
    <p class="muted">${esc(t('plannerHint'))}</p>
    <div class="planner">`;

  for (let i = 0; i < 7; i++) {
    const iso = isoAddDays(start, i);
    const isPast = iso < today;
    const isLater = iso > last;
    const open = !isPast && !isLater;
    const dayMeals = meals.filter((m) => m.meal_date === iso);
    html += `<div class="plan-day ${iso === today ? 'today' : ''} ${isPast ? 'past' : ''}">
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
      html += open
        ? `<button class="plan-cell" onclick="openMealsOn('${iso}')"><small>${esc(t(slot))}</small>${body}</button>`
        : `<div class="plan-cell off"><small>${esc(t(slot))}</small>${body}</div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function moveWeek(d) { plannerWeek += d; loadTab(); }

// Opens the Meals tab on a given day, ready to add or edit meals.
async function openMealsOn(iso) {
  mealsDay = iso;
  mealForm = false;
  mealEditId = null;
  await go('today');
}
