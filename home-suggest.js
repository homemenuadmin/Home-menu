// Home suggestions for the family: for each meal of the day, a few ideas to approve, the approved meal pinned,
// and a picker for anything else. Ideas come from the household's recipes (ready ones first) and, in the
// background, from the AI, which is asked for dishes that use what is in the kitchen.
// Part of Home Menu. Loaded by index.html after home.js.

// Ideas that the AI has been asked for in this page visit, so a failed request isn't repeated on every refresh.
const aiAsked = new Set();
let sgBusy = false; // an approve is in progress

// Everything the Home screen needs: today's meals, recipes, the kitchen and the household's rules.
async function loadPlan() {
  const today = todayIso();
  const [meals, recipes, ings, pantry, rules] = await Promise.all([
    sb.from('meals')
      .select('id, meal_slot, servings, status, recipe_id, recipes(title_en, title_ar)')
      .eq('household_id', hh.id)
      .eq('meal_date', today),
    sb.from('recipes')
      .select('id, household_id, created_by, copied_from, title_en, title_ar, minutes, meal_slot, source, created_at')
      .order('title_en'),
    sb.from('recipe_ingredients').select('id, recipe_id, ingredient_key, name_en, name_ar, quantity, optional'),
    sb.from('pantry_items').select('id, ingredient_key, name_en, name_ar, level').eq('household_id', hh.id).order('name_en'),
    sb.from('rules').select('kind, ingredient_key').eq('household_id', hh.id),
  ]);
  for (const r of [meals, recipes, ings, pantry, rules]) if (r.error) throw r.error;
  const pantryRows = pantry.data || [];
  cache.pickerRecipes = buildPickerRecipes(recipes.data || [], ings.data || [], pantryRows, rules.data || []);
  return {
    today,
    meals: meals.data || [],
    recipes: recipes.data || [],
    pantry: pantryRows,
    low: pantryRows.filter((p) => p.level === 'Low' || p.level === 'Finished'),
  };
}

// The household's recipes that suit a meal: those marked for it or for any meal, ready ones first.
function slotRecipes(slot) {
  return (cache.pickerRecipes || [])
    .filter((r) => !r.meal_slot || r.meal_slot === slot)
    .sort((a, b) => a.missing - b.missing || (a.title_en || '').localeCompare(b.title_en || ''));
}

// A meal with nothing planned yet gets up to three ideas from the household's own recipes.
// Returns true when something was added, so the caller reloads the plan.
async function makeSuggestions(plan) {
  const rows = [];
  for (const slot of SLOTS) {
    if (plan.meals.some((m) => m.meal_slot === slot)) continue;
    for (const r of slotRecipes(slot).slice(0, 3)) {
      rows.push({
        household_id: hh.id,
        created_by: session.user.id,
        meal_date: plan.today,
        meal_slot: slot,
        recipe_id: r.id,
        servings: 4,
        status: 'suggested',
      });
    }
  }
  if (!rows.length) return false;
  const { error } = await sb.from('meals').insert(rows);
  if (error) { setProblem(error); return false; }
  return true;
}

// Asks the AI for ideas for each meal that has no approved meal and no AI ideas yet today. It runs in the
// background: the screen shows at once, and the ideas join the list when they arrive.
function startAiIdeas(plan) {
  for (const slot of SLOTS) {
    const key = plan.today + '|' + slot;
    if (aiAsked.has(key)) continue;
    if (plan.meals.some((m) => m.meal_slot === slot && (m.status === 'approved' || m.status === 'cooked'))) continue;
    const made = plan.recipes.some((r) => r.source === 'ai' && r.meal_slot === slot && (r.created_at || '').slice(0, 10) === plan.today);
    if (made) continue;
    aiAsked.add(key);
    fetchAiIdeas(slot, plan).catch(() => {});
  }
}

async function fetchAiIdeas(slot, plan) {
  const kitchen = plan.pantry.filter((p) => p.level !== 'Finished').map((p) => p.name_en).filter(Boolean).slice(0, 60);
  const input = `Meal: ${slot}. Kitchen items: ${kitchen.join(', ') || 'none listed'}.`;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/groq-suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({ task: 'meal_ideas', household_id: hh.id, input }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.result) throw new Error(body.error || 'AI unavailable');
  const ideas = (Array.isArray(body.result.ideas) ? body.result.ideas : []).slice(0, 3);

  let added = false;
  for (const idea of ideas) {
    const title = String(idea.title || '').trim();
    if (!title) continue;
    const minutes = Math.min(240, Math.max(5, Number(idea.minutes) || 30));
    const { data: rec, error } = await sb.from('recipes').insert({
      household_id: hh.id,
      created_by: session.user.id,
      title_en: title,
      title_ar: '',
      minutes,
      meal_slot: slot,
      source: 'ai',
    }).select('id').single();
    if (error) { setProblem(error); return; }

    const names = (Array.isArray(idea.ingredients) ? idea.ingredients : []).map((n) => String(n).trim()).filter(Boolean).slice(0, 30);
    if (names.length) {
      const { error: ingErr } = await sb.from('recipe_ingredients').insert(names.map((n) => ({
        recipe_id: rec.id,
        ingredient_key: n.toLowerCase(),
        name_en: n,
        name_ar: '',
        quantity: '',
        optional: false,
      })));
      if (ingErr) { setProblem(ingErr); return; }
    }

    const { error: mealErr } = await sb.from('meals').insert({
      household_id: hh.id,
      created_by: session.user.id,
      meal_date: plan.today,
      meal_slot: slot,
      recipe_id: rec.id,
      servings: 4,
      status: 'suggested',
    });
    if (mealErr) { setProblem(mealErr); return; }
    added = true;
  }
  if (added) await loadTab({ quiet: true });
}

// One meal of the day: the pinned meal if one is approved, otherwise the ideas to approve and the picker.
function suggestSlotHtml(slot, plan) {
  const onSlot = plan.meals.filter((m) => m.meal_slot === slot);
  const pinned = onSlot.find((m) => m.status === 'approved' || m.status === 'cooked');
  const byId = new Map((cache.pickerRecipes || []).map((r) => [r.id, r]));
  let body;
  if (pinned) {
    body = pinnedHtml(pinned, byId.get(pinned.recipe_id));
  } else {
    const suggested = onSlot.filter((m) => m.status === 'suggested');
    body = suggested.length
      ? `<div class="sg-list">${suggested.map((m) => suggestRowHtml(m, byId.get(m.recipe_id))).join('')}</div>`
      : `<p class="muted sg-empty">${esc(t('noSuggestions'))}</p>`;
    body += `<button class="sg-pill" data-sg-pick aria-expanded="false">${esc(t('noneOfThese'))}</button>`;
    body += pickerHtml(slot);
  }
  return `<section class="sg-slot" data-sg-slot="${slot}">
    <h3 class="home-label sg-title">${esc(t(slot))}</h3>
    ${body}
  </section>`;
}

function statusTagHtml(status) {
  if (status === 'cooked') return `<span class="tag">${esc(t('cookedDone'))}</span>`;
  return `<span class="tag gold">${esc(t('approved'))}</span>`;
}

function readyTagHtml(r) {
  return r.ready
    ? `<span class="tag">${esc(t('ready'))}</span>`
    : `<span class="tag warn">${esc(t('missing'))} ${r.missing}</span>`;
}

// The approved meal, pinned. Edit opens its ingredients for editing (the same editor as the picker and Recipes),
// and Change puts the meal back among the ideas.
function pinnedHtml(m, r) {
  const change = m.status === 'approved'
    ? `<button class="btn secondary sg-change" data-sg-change="${m.id}">${esc(t('changeMeal'))}</button>`
    : '';
  if (!r) {
    const name = m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '';
    return `<div class="card sg-pin-plain"><div class="row"><strong>${esc(name)}</strong>${statusTagHtml(m.status)}</div>${change}</div>`;
  }
  const ings = r.ings.map((i, idx) => ingLiHtml(i, idx)).join('');
  return `<div class="pick-item open sg-pin sg-pin-in" data-pick="${r.id}">
    <div class="sg-pin-head"><strong>${esc(nameOf(r.title_en, r.title_ar))}</strong>${statusTagHtml(m.status)}<small>${r.minutes} min</small><span class="rstatus">${readyTagHtml(r)}</span></div>
    <div class="pick-details"><div class="pick-details-inner">
      ${ingHeadHtml(r)}
      <ul class="clean pick-ings">${ings}</ul>
      ${ingAddHtml(r)}
      ${change}
    </div></div>
  </div>`;
}

function suggestRowHtml(m, r) {
  const name = r ? nameOf(r.title_en, r.title_ar) : (m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '');
  const tags = (r ? readyTagHtml(r) : '') + (r && r.source === 'ai' ? `<span class="tag gold">${esc(t('aiIdea'))}</span>` : '');
  return `<div class="sg-row" data-sg-meal="${m.id}">
    <div class="sg-row-main"><strong>${esc(name)}</strong>${r ? `<small>${r.minutes} min</small>` : ''}</div>
    <div class="sg-row-tags">${tags}</div>
    <button class="btn small" data-sg-approve="${m.id}">${esc(t('approve'))}</button>
  </div>`;
}

// The picker that "None of these?" opens: every recipe for the meal, with Use this to approve one.
function pickerHtml(slot) {
  const rows = slotRecipes(slot);
  const list = rows.length
    ? rows.map((r) => `<div class="sg-pick-row">
        <div class="sg-row-main"><strong>${esc(nameOf(r.title_en, r.title_ar))}</strong><small>${r.minutes} min</small></div>
        <div class="sg-row-tags">${readyTagHtml(r)}</div>
        <button class="btn small" data-sg-use="${r.id}" data-slot="${slot}">${esc(t('useThis'))}</button>
      </div>`).join('')
    : `<p class="muted">${esc(t('noRecipes'))}</p>`;
  return `<div class="sg-picker">${list}</div>`;
}

// Approve: the other ideas slide away one after another, then the approved meal is pinned.
function sgApprove(mealId, section) {
  if (sgBusy || !section) return;
  sgBusy = true;
  const card = section.querySelector(`[data-sg-meal="${mealId}"]`);
  const others = [...section.querySelectorAll('[data-sg-meal]')].filter((el) => el !== card);
  others.forEach((el, i) => { el.style.transitionDelay = (i * 60) + 'ms'; el.classList.add('sg-away'); });
  if (card) card.classList.add('sg-approving');
  setTimeout(async () => {
    await setMealStatus(mealId, 'approved');
    sgBusy = false;
  }, motion('--sg-approve-ms', 520));
}

async function sgUse(recipeId, slot) {
  const { error } = await sb.from('meals').insert({
    household_id: hh.id,
    created_by: session.user.id,
    meal_date: todayIso(),
    meal_slot: slot,
    recipe_id: recipeId,
    servings: 4,
    status: 'approved',
  });
  if (error) return setProblem(error);
  await loadTab({ quiet: true });
}

// Clicks on the Home suggestions. One listener, so it survives redraws.
document.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-sg-pick]');
  if (pick) {
    const on = pick.closest('.sg-slot').classList.toggle('sg-picking');
    pick.setAttribute('aria-expanded', String(on));
    return;
  }
  const approve = e.target.closest('[data-sg-approve]');
  if (approve) return sgApprove(approve.dataset.sgApprove, approve.closest('.sg-slot'));
  const change = e.target.closest('[data-sg-change]');
  if (change) return setMealStatus(change.dataset.sgChange, 'suggested');
  const use = e.target.closest('[data-sg-use]');
  if (use) return sgUse(use.dataset.sgUse, use.dataset.slot);
});
