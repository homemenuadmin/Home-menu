// Editing a recipe's ingredients, shared by the Recipes tab and the meal picker, and the steps card.
// Each change saves at once. Stepper taps are grouped, so a run of taps saves once.
// Part of Home Menu. Loaded by index.html after core.js. Load order matters: see index.html.

// ---------------------------------------------------------------
// RECIPE EDITING: add, remove and adjust ingredients; the steps card
// ---------------------------------------------------------------
const RI_SELECT = 'id, recipe_id, ingredient_key, name_en, name_ar, quantity, optional';

// Any member of the household (family, cooks, owner) can edit its recipes, and the steps. A shared recipe can't be
// changed itself, so editing it first makes the household's own copy (see copyAndEdit).
function canEditRecipe(row) {
  return !!hh;
}

// An amount is text such as "750 g" or "1 clove". Split it into a number and the rest, or null when there is no number ("to taste").
function parseAmount(q) {
  const m = String(q || '').trim().match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s*(.*)$/);
  if (!m) return null;
  const n = m[1].includes('/') ? m[1].split('/').reduce((a, b) => a / b) : parseFloat(m[1]);
  return { n, unit: m[2] };
}
function fmtAmount(n, unit) {
  const num = Number.isInteger(n) ? String(n) : String(+n.toFixed(2));
  return num + (unit ? ' ' + unit : '');
}
// How far one tap moves the amount: grams and millilitres by 25, measuring spoons and cups by a quarter, anything else by 1.
function stepFor(unit) {
  const u = (unit || '').toLowerCase();
  if (u === 'g' || u === 'ml') return 25;
  if (['cup', 'cups', 'tbsp', 'tsp'].includes(u)) return 0.25;
  return 1;
}
// Whether an ingredient is in stock, from the kitchen data loaded with the screen.
function ingInStock(ing) {
  return !!cache.inStockKeys && cache.inStockKeys.has(ing.ingredient_key);
}

// One ingredient's row. The tools (stepper and ×) sit on the same line as the name and only show while editing.
function ingLiHtml(ing, idx) {
  const name = esc(nameOf(ing.name_en, ing.name_ar));
  const qty = ing.quantity ? `<small class="ing-qty">· ${esc(ing.quantity)}</small>` : '';
  const mark = ing.optional ? `<span class="ing-opt">${esc(t('optional'))}</span>`
    : (ingInStock(ing) ? `<span class="have">✓</span>` : `<span class="lack">${esc(t('missing'))}</span>`);
  const stepper = parseAmount(ing.quantity)
    ? `<span class="ing-step">
        <button type="button" data-ing-act="dec" aria-label="−">−</button>
        <span class="ing-amt">${esc(ing.quantity)}</span>
        <button type="button" data-ing-act="inc" aria-label="+">+</button>
      </span>`
    : `<span class="ing-amt">${esc(ing.quantity || '')}</span>`;
  return `<li style="--i:${idx}" data-ing="${ing.id}"><div class="ing-line">
      <span class="ing-name">${name}${qty ? ' ' + qty : ''}</span>
      <span class="ing-mark">${mark}</span>
      <span class="ing-tools">${stepper}<button type="button" class="ing-x" data-ing-act="remove" aria-label="${esc(t('removeIngredient'))} ${name}">×</button></span>
    </div></li>`;
}

// The heading above an ingredient list. Editable recipes get an Edit button that turns into Done.
function ingHeadHtml(row) {
  if (!canEditRecipe(row)) return `<h3 style="margin-top:0">${esc(t('ingredients'))}</h3>`;
  return `<div class="ings-head"><h3>${esc(t('ingredients'))}</h3>
    <button type="button" class="pick-edit-btn" data-ing-act="toggle" aria-expanded="false">
      <span class="when-read">${esc(t('edit'))}</span><span class="when-edit">${esc(t('done'))}</span>
    </button></div>`;
}

// The add row, shown only while editing. Empty for recipes that can't be changed.
function ingAddHtml(row) {
  if (!canEditRecipe(row)) return '';
  return `<div class="ing-add-wrap" aria-hidden="true"><div class="ing-add">
      <input class="ing-new-name" placeholder="${esc(t('addIngredient'))}" aria-label="${esc(t('addIngredient'))}">
      <input class="ing-new-qty" placeholder="${esc(t('ingAmount'))}" aria-label="${esc(t('ingAmount'))}">
      <button type="button" class="ing-add-btn" data-ing-act="add">${esc(t('ingAdd'))}</button>
    </div></div>`;
}

// The recipe behind a card on either screen: its row, and the ingredient list it edits.
function recipeOfCard(card) {
  if (card.dataset.recipe) {
    const c = cache.recipeList;
    const row = c && c.rows.find((r) => r.id === card.dataset.recipe);
    if (!row) return null;
    c.ingMap[row.id] = c.ingMap[row.id] || [];
    return { row, ings: c.ingMap[row.id], screen: 'recipes' };
  }
  const row = (cache.pickerRecipes || []).find((r) => r.id === card.dataset.pick);
  return row ? { row, ings: row.ings, screen: 'picker' } : null;
}

function toggleIngEdit(card, on) {
  const editing = on === undefined ? !card.classList.contains('editing') : on;
  card.classList.toggle('editing', editing);
  const btn = card.querySelector('.pick-edit-btn');
  if (btn) btn.setAttribute('aria-expanded', String(editing));
  const add = card.querySelector('.ing-add-wrap');
  if (add) add.setAttribute('aria-hidden', String(!editing));
}

// After a change, the Ready / Missing tag is worked out again from the ingredients and the kitchen.
function refreshRecipeStatus(rec) {
  const required = rec.ings.filter((i) => !i.optional);
  const missing = required.filter((i) => !ingInStock(i)).length;
  if (rec.screen === 'recipes' && cache.recipeList) {
    cache.recipeList.availMap[rec.row.id] = { recipe_id: rec.row.id, required_count: required.length, in_stock_count: required.length - missing };
  } else {
    rec.row.missing = missing;
    rec.row.ready = missing === 0;
  }
  const html = missing === 0
    ? `<span class="tag">${esc(t('ready'))}</span>`
    : `<span class="tag warn">${esc(t('missing'))} ${missing}</span>`;
  document.querySelectorAll(`[data-recipe="${rec.row.id}"] .rstatus, [data-pick="${rec.row.id}"] .rstatus`)
    .forEach((el) => { el.innerHTML = html; });
}

// Clicks on the edit controls. One listener covers both screens, so it survives redraws.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ing-act]');
  if (!btn) return;
  const card = btn.closest('.pick-item');
  const rec = card && recipeOfCard(card);
  if (!rec || !canEditRecipe(rec.row)) return;
  const act = btn.dataset.ingAct;
  if (act === 'toggle') return rec.row.household_id ? toggleIngEdit(card) : copyAndEdit(card, rec);
  if (act === 'add') return addIng(card, rec);
  const li = btn.closest('li[data-ing]');
  const ing = li && rec.ings.find((i) => i.id === li.dataset.ing);
  if (!ing) return;
  if (act === 'inc' || act === 'dec') return adjustIng(rec, li, ing, act === 'inc' ? 1 : -1);
  if (act === 'remove') return removeIng(rec, li, ing);
});

// Saves are grouped per ingredient, so a run of stepper taps writes once, with the latest amount.
const ingSaveTimers = {};
function adjustIng(rec, li, ing, dir) {
  const p = parseAmount(ing.quantity);
  if (!p) return;
  const step = stepFor(p.unit);
  const n = Math.max(step, +(p.n + dir * step).toFixed(2));
  ing.quantity = fmtAmount(n, p.unit);
  li.querySelector('.ing-amt').textContent = ing.quantity;
  const qtyEl = li.querySelector('.ing-qty');
  if (qtyEl) qtyEl.textContent = '· ' + ing.quantity;
  refreshRecipeStatus(rec);
  clearTimeout(ingSaveTimers[ing.id]);
  ingSaveTimers[ing.id] = setTimeout(async () => {
    const { error } = await sb.from('recipe_ingredients').update({ quantity: ing.quantity }).eq('id', ing.id);
    if (error) { setProblem(error); loadTab({ quiet: true }); }
  }, 400);
}

async function removeIng(rec, li, ing) {
  clearTimeout(ingSaveTimers[ing.id]);
  rec.ings.splice(rec.ings.indexOf(ing), 1);
  refreshRecipeStatus(rec);
  li.classList.add('leaving');
  setTimeout(() => li.remove(), motion('--pick-close', 380));
  const { error } = await sb.from('recipe_ingredients').delete().eq('id', ing.id);
  if (error) { setProblem(error); loadTab({ quiet: true }); }
}

async function addIng(card, rec) {
  const nameEl = card.querySelector('.ing-new-name');
  const qtyEl = card.querySelector('.ing-new-qty');
  const name = nameEl.value.trim();
  if (!name) return nameEl.focus();
  const { data, error } = await sb.from('recipe_ingredients').insert({
    recipe_id: rec.row.id,
    ingredient_key: name.toLowerCase(),
    name_en: name,
    name_ar: '',
    quantity: qtyEl.value.trim(),
    optional: false,
  }).select(RI_SELECT).single();
  if (error) return setProblem(error);
  nameEl.value = '';
  qtyEl.value = '';
  rec.ings.push(data);
  card.querySelector('ul.pick-ings').insertAdjacentHTML('beforeend', ingLiHtml(data, rec.ings.length - 1));
  refreshRecipeStatus(rec);
}

// A shared recipe becomes the household's own copy, which is then the one that gets edited. Returns the copy's id.
async function makeHouseholdCopy(row) {
  const { data, error } = await sb.rpc('copy_recipe', { src: row.id, hid: hh.id });
  if (error) { setProblem(error); return null; }
  return data;
}

// Editing a shared recipe's ingredients: copy it, then reload the screen with the copy open and in edit mode.
async function copyAndEdit(card, rec) {
  const id = await makeHouseholdCopy(rec.row);
  if (!id) return;
  if (rec.screen === 'recipes') openRecipeId = id;
  else pickerState.openId = id;
  await loadTab({ quiet: true });
  const el = document.querySelector(`[data-recipe="${id}"], [data-pick="${id}"]`);
  if (el) toggleIngEdit(el, true);
}

// The field the steps are kept in: English or Arabic, following the language on screen.
function stepsField() { return lang === 'ar' ? 'steps_ar' : 'steps_en'; }

// The steps card: a sheet that rises over the screen with the recipe's steps, one per line. Anyone in the household can
// edit them, using the Edit button in the sheet.
function openRecipeSteps(id, startEdit) {
  const row = cache.recipeList && cache.recipeList.rows.find((r) => r.id === id);
  if (!row) return;
  let sheet = document.getElementById('stepsSheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'stepsSheet';
    sheet.innerHTML = `<div class="steps-scrim" data-steps-close></div>
      <div class="steps-sheet" role="dialog" aria-modal="true">
        <div class="steps-grab"></div>
        <div class="steps-head"><h2></h2>
          <div class="steps-head-actions">
            <button type="button" class="steps-edit-btn" data-steps-act="edit">${esc(t('edit'))}</button>
            <button type="button" class="steps-done" data-steps-close>${esc(t('done'))}</button>
          </div></div>
        <ol class="steps-list"></ol>
        <div class="steps-editor">
          <textarea class="steps-text" rows="8" aria-label="${esc(t('steps'))}"></textarea>
          <p class="muted steps-hint">${esc(t('stepsHint'))}</p>
          <div class="steps-editor-actions">
            <button type="button" class="btn secondary" data-steps-act="cancel">${esc(t('cancel'))}</button>
            <button type="button" class="btn" data-steps-act="save">${esc(t('save'))}</button>
          </div>
        </div>
      </div>`;
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-steps-close]')) return closeRecipeSteps();
      const act = e.target.closest('[data-steps-act]');
      if (!act) return;
      const r = cache.recipeList && cache.recipeList.rows.find((x) => x.id === sheet.dataset.recipe);
      if (!r) return;
      if (act.dataset.stepsAct === 'edit') return showStepsEditor(sheet, r);
      if (act.dataset.stepsAct === 'cancel') return openRecipeSteps(r.id);
      if (act.dataset.stepsAct === 'save') return saveSteps(r, sheet.querySelector('.steps-text').value);
    });
    document.body.appendChild(sheet);
  }
  sheet.dataset.recipe = id;
  sheet.classList.remove('steps-editing');
  sheet.querySelector('h2').textContent = nameOf(row.title_en, row.title_ar);
  sheet.querySelector('.steps-edit-btn').hidden = !canEditRecipe(row);
  const steps = (row[stepsField()] || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  sheet.querySelector('.steps-list').innerHTML = steps.length
    ? steps.map((s) => `<li><p>${esc(s)}</p></li>`).join('')
    : `<p class="muted">${esc(t('noSteps'))}</p>`;
  requestAnimationFrame(() => sheet.classList.add('on'));
  if (startEdit) showStepsEditor(sheet, row);
}
function showStepsEditor(sheet, row) {
  sheet.querySelector('.steps-text').value = row[stepsField()] || '';
  sheet.classList.add('steps-editing');
  sheet.querySelector('.steps-text').focus();
}
// Saving edits the household's copy when the recipe is shared, so the change is the household's own.
async function saveSteps(row, text) {
  const field = stepsField();
  if (!row.household_id) {
    const id = await makeHouseholdCopy(row);
    if (!id) return;
    const { error } = await sb.from('recipes').update({ [field]: text }).eq('id', id);
    if (error) return setProblem(error);
    openRecipeId = id;
    await loadTab({ quiet: true });
    return openRecipeSteps(id);
  }
  const { error } = await sb.from('recipes').update({ [field]: text }).eq('id', row.id);
  if (error) return setProblem(error);
  row[field] = text;
  openRecipeSteps(row.id);
}
function closeRecipeSteps() {
  const sheet = document.getElementById('stepsSheet');
  if (sheet) sheet.classList.remove('on', 'steps-editing');
}
