// Today tab: meals for the day.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// TODAY: meals for today
// ---------------------------------------------------------------
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function screenToday() {
  const day = todayIso();
  const niceDate = new Date().toLocaleDateString(t('dateLocale'), { weekday: 'long', day: 'numeric', month: 'long' });
  const { data: meals, error } = await sb
    .from('meals')
    .select('id, meal_slot, servings, status, recipe_id, recipes(title_en, title_ar)')
    .eq('household_id', hh.id)
    .eq('meal_date', day);
  if (error) throw error;
  cache.meals = meals || [];

  let html = `<p class="muted">${esc(niceDate)}</p>
    <p>${esc(roleNote())}</p>`;

  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const list = cache.meals.filter((m) => m.meal_slot === slot);
    html += `<div class="card"><h2 style="margin-top:0">${esc(t(slot))}</h2>`;
    if (!list.length) html += `<p class="muted">${esc(t('noMealsSlot'))}</p>`;
    html += '<ul class="clean">';
    for (const m of list) {
      const title = m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '';
      const statusTag = m.status === 'cooked' ? `<span class="tag">${esc(t('cookedDone'))}</span>`
        : m.status === 'approved' ? `<span class="tag gold">${esc(t('approved'))}</span>`
        : `<span class="tag warn">${esc(t('suggested'))}</span>`;
      let actions = '';
      if (m.status === 'suggested' && can.approve()) actions += `<button class="btn small" onclick="setMealStatus('${m.id}','approved')">${esc(t('approve'))}</button> `;
      if (m.status !== 'cooked' && can.cook()) actions += `<button class="btn small secondary" onclick="setMealStatus('${m.id}','cooked')">${esc(t('markCooked'))}</button> `;
      if (can.deleteMeal()) actions += `<button class="btn small danger" onclick="removeMeal('${m.id}')">${esc(t('deleteMeal'))}</button>`;
      html += `<li><div class="row"><strong>${esc(title)} · ${m.servings}</strong>${statusTag}</div><div>${actions}</div></li>`;
    }
    html += '</ul></div>';
  }

  if (mealForm) {
    const { data: recipes } = await sb.from('recipes').select('id, title_en, title_ar').order('title_en');
    cache.recipes = recipes || [];
    html += `<div class="card"><h2 style="margin-top:0">${esc(t('addMeal'))}</h2>
      <label>${esc(t('chooseSlot'))}</label>
      <select id="mslot">${['breakfast', 'lunch', 'dinner'].map((s) => `<option value="${s}">${esc(t(s))}</option>`).join('')}</select>
      <label>${esc(t('chooseRecipe'))}</label>
      <select id="mrecipe">${cache.recipes.map((r) => `<option value="${r.id}">${esc(nameOf(r.title_en, r.title_ar))}</option>`).join('')}</select>
      <label>${esc(t('servings'))}</label>
      <select id="mservings">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select>
      <button class="btn" onclick="saveMeal()">${esc(t('save'))}</button>
      <button class="btn secondary" onclick="toggleMealForm(false)">${esc(t('cancel'))}</button></div>`;
  } else {
    html += `<button class="btn" onclick="toggleMealForm(true)">${esc(t('addMeal'))}</button>`;
  }
  return html;
}

async function toggleMealForm(on) { mealForm = on; await loadTab(); }

async function saveMeal() {
  const { error } = await sb.from('meals').insert({
    household_id: hh.id,
    meal_date: todayIso(),
    meal_slot: document.getElementById('mslot').value,
    recipe_id: document.getElementById('mrecipe').value,
    servings: Number(document.getElementById('mservings').value),
    status: 'suggested',
    created_by: session.user.id,
  });
  if (error) return setProblem(error);
  mealForm = false;
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
