// Home tab: a short dashboard. Today's meals, kitchen items that need attention, and quick ways in.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

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

  let html = `
    <div class="card home-hero">
      <div class="muted">${esc(niceDate)}</div>
      <h2 style="margin:4px 0 0">${esc(greeting)}</h2>
      <p class="muted" style="margin:6px 0 0">${esc(roleNote())}</p>
    </div>
    <h3 class="home-label">${esc(t('todayMeals'))}</h3>`;

  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const m = (meals.data || []).find((x) => x.meal_slot === slot);
    const title = m && m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '';
    html += `<button class="card tile" onclick="go('today')">
      <span class="muted">${esc(t(slot))}</span>
      <strong>${esc(title || t('noMealsSlot'))}</strong>
    </button>`;
  }

  html += `<h3 class="home-label">${esc(t('kitchenAlerts'))}</h3>`;
  if (!low.data.length) {
    html += `<div class="card"><p class="muted" style="margin:0">${esc(t('nothingLow'))}</p></div>`;
  } else {
    html += `<button class="card tile" onclick="go('kitchen')">
      <span class="muted">${low.data.length} · ${esc(t('needsRestock'))}</span>
      <ul class="clean home-low">${low.data.slice(0, 3).map((i) =>
        `<li><strong>${esc(nameOf(i.name_en, i.name_ar))}</strong> <span class="tag warn">${esc(t(i.level))}</span></li>`).join('')}</ul>
    </button>`;
  }

  html += `<div class="home-actions">
    <button class="btn" onclick="homeAddMeal()">${esc(t('addMeal'))}</button>
    <button class="btn secondary" onclick="go('kitchen')">${esc(t('openKitchen'))}</button>
  </div>`;
  return html;
}

// Opens Today with the add-a-meal form already showing.
async function homeAddMeal() {
  tab = 'today';
  drawerOpen = false;
  mealForm = true;
  await loadTab();
}
