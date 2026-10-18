// Recipes tab: browse, matched to stock, filtered by rules.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// RECIPES: browse, matched to stock, filtered by rules
// ---------------------------------------------------------------
async function screenRecipes() {
  const [rec, ings, avail, pantry, rules] = await Promise.all([
    sb.from('recipes').select('id, household_id, title_en, title_ar, minutes, meal_slot, steps_en, steps_ar').order('title_en'),
    sb.from('recipe_ingredients').select('recipe_id, ingredient_key, name_en, name_ar, quantity, optional'),
    sb.from('recipe_availability').select('recipe_id, required_count, in_stock_count').eq('household_id', hh.id),
    sb.from('pantry_items').select('ingredient_key, level').eq('household_id', hh.id),
    sb.from('rules').select('kind, text_en, text_ar, ingredient_key').eq('household_id', hh.id),
  ]);
  for (const r of [rec, ings, avail, pantry, rules]) if (r.error) throw r.error;

  const inStock = new Set(pantry.data.filter((p) => p.level !== 'Finished').map((p) => p.ingredient_key));
  const donts = new Set(rules.data.filter((r) => r.kind === 'dont' && r.ingredient_key).map((r) => r.ingredient_key));
  const availMap = Object.fromEntries(avail.data.map((a) => [a.recipe_id, a]));
  const ingMap = {};
  for (const i of ings.data) (ingMap[i.recipe_id] = ingMap[i.recipe_id] || []).push(i);
  cache.recipeIngredients = ingMap;

  let hidden = 0;
  const shown = rec.data.filter((r) => {
    const keys = (ingMap[r.id] || []).map((i) => i.ingredient_key);
    if (keys.some((k) => donts.has(k))) { hidden++; return false; }
    return true;
  }).filter((r) => {
    if (!recipeFilter) return true;
    const q = recipeFilter.toLowerCase();
    return (r.title_en || '').toLowerCase().includes(q) || (r.title_ar || '').includes(recipeFilter);
  });

  let html = `<input id="rsearch" placeholder="${esc(t('search'))}" value="${esc(recipeFilter)}" oninput="filterRecipes(this.value)">`;
  if (hidden) html += `<p class="muted">${hidden} ${esc(t('hiddenByRules'))}</p>`;

  if (openRecipeId) {
    const r = rec.data.find((x) => x.id === openRecipeId);
    if (r) {
      const list = ingMap[r.id] || [];
      html += `<div class="card"><h2 style="margin-top:0">${esc(nameOf(r.title_en, r.title_ar))}</h2>
        <p class="muted">${esc(t(r.meal_slot || 'lunch'))} · ${r.minutes} min</p>
        <h3>${esc(t('ingredients'))}</h3><ul class="clean">`;
      for (const i of list) {
        const have = inStock.has(i.ingredient_key);
        const mark = i.optional ? '' : (have ? `<span class="have">✓</span>` : `<span class="lack">${esc(t('missing'))}</span>`);
        html += `<li><div class="row"><span>${esc(nameOf(i.name_en, i.name_ar))}${i.quantity ? ' · ' + esc(i.quantity) : ''}${i.optional ? ' · (optional)' : ''}</span>${mark}</div></li>`;
      }
      html += `</ul><h3>${esc(t('steps'))}</h3><p class="step">${esc(nameOf(r.steps_en, r.steps_ar)).replace(/\n/g, '<br>')}</p>
        <button class="btn secondary" onclick="closeRecipe()">${esc(t('back'))}</button></div>`;
    }
    return html;
  }

  if (!shown.length) html += `<p class="muted">${esc(t('noRecipes'))}</p>`;
  for (const r of shown) {
    const a = availMap[r.id];
    const ready = a && a.in_stock_count >= a.required_count;
    const status = ready
      ? `<span class="tag">${esc(t('ready'))}</span>`
      : `<span class="tag warn">${esc(t('missing'))} ${a ? a.required_count - a.in_stock_count : '?'}</span>`;
    html += `<div class="card" onclick="openRecipe('${r.id}')" style="cursor:pointer">
      <div class="row"><strong>${esc(nameOf(r.title_en, r.title_ar))}</strong>${status}</div>
      <div class="muted">${esc(t(r.meal_slot || 'lunch'))} · ${r.minutes} min</div></div>`;
  }
  return html;
}

let filterTimer = null;
function filterRecipes(v) {
  recipeFilter = v;
  clearTimeout(filterTimer);
  filterTimer = setTimeout(loadTab, 250);
}
async function openRecipe(id) { openRecipeId = id; await loadTab(); }
async function closeRecipe() { openRecipeId = null; await loadTab(); }
