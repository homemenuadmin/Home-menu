// Recipes tab: browse, matched to stock, filtered by rules.
// Each recipe opens in place, the same way as a card in the meal picker. Searching filters the list
// without redrawing the screen, so the search box keeps its place.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// RECIPES: browse, matched to stock, filtered by rules
// ---------------------------------------------------------------
async function screenRecipes() {
  const [rec, ings, avail, pantry, rules] = await Promise.all([
    sb.from('recipes').select('id, household_id, created_by, title_en, title_ar, minutes, meal_slot, steps_en, steps_ar').order('title_en'),
    sb.from('recipe_ingredients').select('id, recipe_id, ingredient_key, name_en, name_ar, quantity, optional'),
    sb.from('recipe_availability').select('recipe_id, required_count, in_stock_count').eq('household_id', hh.id),
    sb.from('pantry_items').select('ingredient_key, level').eq('household_id', hh.id),
    sb.from('rules').select('kind, text_en, text_ar, ingredient_key').eq('household_id', hh.id),
  ]);
  for (const r of [rec, ings, avail, pantry, rules]) if (r.error) throw r.error;

  const inStock = new Set(pantry.data.filter((p) => p.level !== 'Finished').map((p) => p.ingredient_key));
  cache.inStockKeys = inStock;
  const donts = new Set(rules.data.filter((r) => r.kind === 'dont' && r.ingredient_key).map((r) => r.ingredient_key));
  const availMap = Object.fromEntries(avail.data.map((a) => [a.recipe_id, a]));
  const ingMap = {};
  for (const i of ings.data) (ingMap[i.recipe_id] = ingMap[i.recipe_id] || []).push(i);
  cache.recipeIngredients = ingMap;

  // Recipes with an ingredient the household has ruled out are hidden.
  const rows = rec.data.filter((r) => !(ingMap[r.id] || []).some((i) => donts.has(i.ingredient_key)));
  const hidden = rec.data.length - rows.length;
  cache.recipeList = { rows, inStock, availMap, ingMap };

  let html = `<input id="rsearch" placeholder="${esc(t('search'))}" value="${esc(recipeFilter)}" oninput="filterRecipes(this.value)">`;
  if (hidden) html += `<p class="muted">${hidden} ${esc(t('hiddenByRules'))}</p>`;
  html += `<div id="recipeList" data-keep-scroll>${recipeListHtml()}</div>`;
  return html;
}

// The list, filtered by the search. Built from the data already loaded, so searching needs no network.
function recipeListHtml() {
  const c = cache.recipeList;
  if (!c) return '';
  const q = (recipeFilter || '').trim().toLowerCase();
  const qRaw = (recipeFilter || '').trim();
  const shown = c.rows.filter((r) => !q || (r.title_en || '').toLowerCase().includes(q) || (r.title_ar || '').includes(qRaw));
  if (!shown.length) return `<p class="muted">${esc(t('noRecipes'))}</p>`;
  return shown.map((r) => recipeRowHtml(r, c)).join('');
}

// One recipe: a row that opens in place to its ingredients and steps. It is built once, and opening
// only changes its classes (see paintRecipes), so the browser can animate it.
function recipeRowHtml(r, c) {
  const open = openRecipeId === r.id;
  const a = c.availMap[r.id];
  const ready = a && a.in_stock_count >= a.required_count;
  const status = ready
    ? `<span class="tag">${esc(t('ready'))}</span>`
    : `<span class="tag warn">${esc(t('missing'))} ${a ? a.required_count - a.in_stock_count : '?'}</span>`;
  const ings = (c.ingMap[r.id] || []).map((i, idx) => ingLiHtml(i, idx)).join('');
  return `<div class="pick-item ${open ? 'open' : ''}" data-recipe="${r.id}">
      <button class="pick-row" onclick="toggleRecipe('${r.id}')" aria-expanded="${open}">
        <span class="pick-meta"><strong>${esc(nameOf(r.title_en, r.title_ar))}</strong><small>${esc(t(r.meal_slot || 'lunch'))} · ${r.minutes} min</small><span class="rstatus">${status}</span></span>
        <span class="pick-chev" aria-hidden="true">⌄</span>
      </button>
      <div class="pick-details"><div class="pick-details-inner">
        ${ingHeadHtml(r)}
        <ul class="clean pick-ings">${ings}</ul>
        ${ingAddHtml(r)}
        <div class="pick-cancel"><button class="btn" onclick="openRecipeSteps('${r.id}')">${esc(t('viewSteps'))}</button></div>
        <div class="pick-cancel"><button class="btn secondary" onclick="closeRecipe()">${esc(t('back'))}</button></div>
      </div></div>
    </div>`;
}

// Searching: only the list is drawn again, so the search box keeps focus.
function filterRecipes(v) {
  recipeFilter = v;
  const el = document.getElementById('recipeList');
  if (el) el.innerHTML = recipeListHtml();
}

// Opening and closing change only the classes on the existing rows, so the browser animates between states.
function paintRecipes() {
  document.querySelectorAll('[data-recipe]').forEach((el) => {
    const open = el.dataset.recipe === openRecipeId;
    el.classList.toggle('open', open);
    if (!open) toggleIngEdit(el, false);
    el.querySelector('.pick-row').setAttribute('aria-expanded', String(open));
  });
}
function toggleRecipe(id) {
  openRecipeId = openRecipeId === id ? null : id;
  paintRecipes();
  if (openRecipeId) {
    // Once it has opened, bring its bottom edge into view if it has gone below the screen.
    setTimeout(() => {
      const el = document.querySelector(`[data-recipe="${openRecipeId}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, motion('--pick-open', 460));
  }
}
function closeRecipe() { openRecipeId = null; paintRecipes(); }
