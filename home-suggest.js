// Home suggestions for the family, laid out as in the approved mockup (Mock-ups/home-cards-mockup.html):
// one meal time at a time, its ideas as a stack of cards to swipe through (a card swiped away keeps a sliver to swipe back).
// Approve sends the others away and pins the approved meal; tap a card to open it; Edit changes its name, minutes and ingredients.
// "None of these?" opens the picker. The Breakfast / Lunch / Dinner bar grows out of the Home tab. Ideas come from the household's recipes (ready ones first)
// and, in the background, from the AI, which is asked for dishes that use what is in the kitchen.
// Part of Home Menu. Loaded by index.html after home.js.

const aiAsked = new Set();                 // AI ideas asked for in this page visit, so a failed request isn't repeated
const deck = { cur: 0, ui: {} };           // which meal time is in front (index into SLOTS), and each meal time's card state
let deckBusy = false;                      // an approve is in progress
let suppressClick = false;                 // a drag just ended, so the click that follows is ignored

// Everything the Home screen needs: today's meals, recipes, the kitchen and the household's rules.
async function loadPlan() {
  const today = todayIso();
  const [meals, recipes, ings, pantry, rules] = await Promise.all([
    sb.from('meals')
      .select('id, meal_slot, servings, status, recipe_id, recipes(title_en, title_ar)')
      .eq('household_id', hh.id)
      .eq('meal_date', today),
    sb.from('recipes')
      .select('id, household_id, created_by, copied_from, title_en, title_ar, minutes, meal_slot, source, created_at, steps_en, steps_ar')
      .order('title_en'),
    sb.from('recipe_ingredients').select('id, recipe_id, ingredient_key, name_en, name_ar, quantity, optional'),
    sb.from('pantry_items').select('id, ingredient_key, name_en, name_ar, level').eq('household_id', hh.id).order('name_en'),
    sb.from('rules').select('kind, ingredient_key').eq('household_id', hh.id),
  ]);
  for (const r of [meals, recipes, ings, pantry, rules]) if (r.error) throw r.error;
  const pantryRows = pantry.data || [];
  cache.pickerRecipes = buildPickerRecipes(recipes.data || [], ings.data || [], pantryRows, rules.data || []);
  const raw = new Map((recipes.data || []).map((r) => [r.id, r]));
  for (const r of cache.pickerRecipes) r.desc = describe(raw.get(r.id) || {}, r.ings);
  return {
    today,
    meals: meals.data || [],
    recipes: recipes.data || [],
    pantry: pantryRows,
    low: pantryRows.filter((p) => p.level === 'Low' || p.level === 'Finished'),
  };
}

// The line under a dish's name: the start of its steps, or the ingredients for an idea that has no steps yet.
function describe(src, ings) {
  const steps = String(nameOf(src.steps_en || '', src.steps_ar || '') || '').replace(/\s+/g, ' ').trim();
  if (steps) return steps.length > 140 ? steps.slice(0, 137).trimEnd() + '…' : steps;
  const names = (ings || []).map((i) => nameOf(i.name_en, i.name_ar)).filter(Boolean).slice(0, 5);
  return names.length ? t('withLabel') + ': ' + names.join(', ') : '';
}

// The recipes that suit a meal: those marked for it or for any meal, ready ones first.
function slotRecipes(slot) {
  return (cache.pickerRecipes || [])
    .filter((r) => !r.meal_slot || r.meal_slot === slot)
    .sort((a, b) => rankOf(a) - rankOf(b) || (a.title_en || '').localeCompare(b.title_en || ''));
}

// Best matches first: ready recipes, then AI ideas, then the fewest missing ingredients.
function rankOf(r) { return r.ready ? 0 : r.source === 'ai' ? 1 : 2 + r.missing; }

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
// background: the screen shows at once, and the ideas join the deck when they arrive.
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


// What one meal card holds: the approved meal alone, or the ideas for it, best first.
function slotState(plan, slot) {
  const onSlot = plan.meals.filter((m) => m.meal_slot === slot);
  const byId = new Map((cache.pickerRecipes || []).map((r) => [r.id, r]));
  const pick = (m) => ({ meal: m, r: byId.get(m.recipe_id) || null });
  const approved = onSlot.find((m) => m.status === 'approved' || m.status === 'cooked') || null;
  const items = approved
    ? [pick(approved)]
    : onSlot.filter((m) => m.status === 'suggested').map(pick).filter((x) => x.r)
        .sort((a, b) => rankOf(a.r) - rankOf(b.r));
  return { slot, approved, items };
}

// The colour a dish's picture takes, from its id, so it stays the same.
function colorFor(id) {
  return PICK_COLORS[[...String(id)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % PICK_COLORS.length];
}
function kindChipHtml(r) {
  if (!r) return '';
  if (r.source === 'ai') return `<span class="dk-chip ai">${esc(t('aiIdea'))}</span>`;
  return r.ready
    ? `<span class="dk-chip ready">${esc(t('haveEverything'))}</span>`
    : `<span class="dk-chip miss">${esc(t('missing'))} ${r.missing}</span>`;
}

// Each meal time's state on screen: which card is in front, whether it is open, and an edit in progress.
function ui(slot) {
  return deck.ui[slot] || (deck.ui[slot] = { idx: 0, open: false, editing: false, draft: null });
}
function curSlot() { return SLOTS[deck.cur]; }

// One idea in the stack. Its ingredients come from the real recipe, so Edit saves to it.
function cardHtml(item, i, n, pinned, front, u) {
  const { meal: m, r } = item;
  const name = r ? nameOf(r.title_en, r.title_ar) : (m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '');
  const color = colorFor(r ? r.id : m.recipe_id || m.id);
  const letter = esc((name || '?').trim().charAt(0).toUpperCase());
  const isOpen = front && u.open;
  const isEditing = front && u.editing && u.draft;
  const top = `<span>${pinned ? esc(t(m.meal_slot || curSlot())) : esc(t('dkIdeaOf').replace('{n}', i + 1).replace('{m}', n))}</span>` +
    `<span class="dk-status${pinned ? ' ok' : ''}">${esc(pinned ? t('approved') : t('suggested'))}</span>`;
  const ings = r ? r.ings.map((g) => `<div class="dk-ing"><span>${esc(nameOf(g.name_en, g.name_ar))}</span>${
    g.optional ? `<b class="opt">${esc(t('optional'))}</b>` : ingInStock(g) ? '<b>✓</b>' : `<b class="no">${esc(t('missing'))}</b>`
  }</div>`).join('') : '';
  const body = isEditing ? '' :
    `<div class="dk-title">${esc(name)}</div>
     <div class="dk-meta"><span class="dk-chip">${r ? r.minutes : ''} min</span>${kindChipHtml(r)}</div>
     ${r && r.desc ? `<p class="dk-desc">${esc(r.desc)}</p>` : ''}
     <div class="dk-tile">${letter}</div>
     <div class="dk-ings"><div class="dk-h">${esc(t('ingredients'))}</div>${ings}</div>`;
  const primary = pinned
    ? `<button class="dk-btn soft" data-dk-act="change" data-id="${m.id}">${esc(t('changeMeal'))}</button>`
    : `<button class="dk-btn" data-dk-act="approve" data-id="${m.id}">${esc(t('approve'))}</button>`;
  const foot = isEditing ? '' :
    `<div class="dk-foot dk-closed">${primary}</div>` +
    `<div class="dk-foot dk-openonly">${primary}<button class="dk-btn ghost" data-dk-act="edit">${esc(t('edit'))}</button><button class="dk-btn ghost" data-dk-act="close">${esc(t('close'))}</button></div>`;
  return `<article class="dk-card${pinned ? ' pinned' : ''}${isOpen ? ' open' : ''}${isEditing ? ' editing' : ''}" data-dk-card="${m.id}" data-i="${i}" style="--accent:${color}">
    <div class="dk-top">${top}</div>
    ${body}
    ${isEditing ? `<div class="dk-title dk-edit-title">${esc(t('dkEditTitle'))}</div>${editorHtml(u.draft)}` : ''}
    <div class="dk-spacer"></div>${foot}
  </article>`;
}

// The editor inside an open card: name, minutes and the ingredient names.
function editorHtml(d) {
  return `<div class="dk-editor">
    <label>${esc(t('dkMealName'))}<input data-dk-f="title" value="${esc(d.title)}"></label>
    <label>${esc(t('dkMinutes'))}<input data-dk-f="min" type="number" inputmode="numeric" value="${esc(d.min)}"></label>
    <div class="dk-h">${esc(t('ingredients'))}</div>
    ${d.ings.map((g, i) => `<div class="dk-erow"><input data-dk-ing="${i}" value="${esc(g.name)}" aria-label="${esc(t('ingredients'))} ${i + 1}">
      <button type="button" data-dk-act="rm" data-i="${i}" aria-label="${esc(t('removeIngredient'))}">×</button></div>`).join('')}
    <button type="button" class="dk-add" data-dk-act="add-ing">+ ${esc(t('addIngredient'))}</button>
    <div class="dk-bar2"><button type="button" class="dk-btn" data-dk-act="save">${esc(t('save'))}</button>
      <button type="button" class="dk-btn ghost" data-dk-act="cancel-edit">${esc(t('cancel'))}</button></div>
  </div>`;
}

// The shape of each meal time as text, so a redraw only happens when something in that meal time changed.
function slotSig(plan, slot) { return JSON.stringify(slotState(plan, slot)); }

// The HTML of the kitchen alerts, and each meal time's shape. Compared with the last draw to find what changed.
function deckParts(plan) {
  return {
    slots: Object.fromEntries(SLOTS.map((s) => [s, slotSig(plan, s)])),
    alerts: kitchenAlertsHtml(plan.low),
  };
}

// Redraws the current meal's cards if that meal changed; other meal times only update the bar's marks.
function patchDeck(plan, slots) {
  if (!document.getElementById('sgStage')) return false;
  if (slots.includes(curSlot())) {
    if (ui(curSlot()).editing) return true;   // an edit in progress is kept; the new data shows when it ends
    renderStage();
  }
  drawMealTimes();
  return true;
}

// The home markup: the deck of cards for the current meal, and the "None of these?" button under it.
function deckHtml(plan) {
  return `<div class="dk-deck" id="sgDeck">
      <div class="dk-stage" id="sgStage"></div>
      <div class="dk-sheet" id="sgSheet" aria-hidden="true"></div>
    </div>
    <div class="dk-none-row" id="sgNoneRow"><button type="button" class="dk-none" id="sgNone" data-dk-act="choose">${esc(t('dkNone'))}</button></div>`;
}

// ----- the stack: the front card full size, the next ones behind it, the one swiped away kept as a sliver -----
// As in the approved mockup: a card swiped away slides off over the edge and keeps a sliver, so it can be swiped back.
const PEEK = 16;
function pose(off, sw, dx) {
  const cw = sw - 40, moves = off === 0 || off === -1;     // only the front card and the one swiped away follow the finger
  const x = off === 0 ? 0 : off < 0 ? -(cw + 20 - PEEK) : off * 10;
  const scale = off > 0 ? 1 - off * 0.035 : 1;
  return 'translateX(' + (x + (moves && dx ? dx : 0)) + 'px) scale(' + scale + ')';
}

function frontIndex() {
  const stage = document.getElementById('sgStage');
  return stage && stage.dataset.pinned === '1' ? 0 : ui(curSlot()).idx;
}

function layoutCards(animate, skip, dx) {
  const stage = document.getElementById('sgStage');
  if (!stage || !lastPlan) return;
  const u = ui(curSlot()), idx = frontIndex(), sw = stage.clientWidth || 340;
  stage.querySelectorAll('.dk-card').forEach((el, i) => {
    if (el === skip) return;
    const off = i - idx, expanded = off === 0 && u.open;
    el.style.transition = animate ? 'transform .45s cubic-bezier(.16,1,.3,1), opacity .3s ease' : 'none';
    el.style.transitionDelay = '0ms';
    el.style.transform = expanded ? 'none' : pose(off, sw, dx);
    el.style.zIndex = String(expanded ? 30 : off === 0 ? 30 : off < 0 ? 40 : 26 - off);
    el.style.opacity = (!expanded && (off > 2 || off < -1)) ? '0' : '1';
  });
  const none = document.getElementById('sgNoneRow');
  if (none) none.classList.toggle('hide', !!slotState(lastPlan, curSlot()).approved || u.open);
}

// Draws the current meal's cards, and places them. Opts: enter (slide direction when the meal changes),
// arrive (the approved card settles in), cardsIn (after Change, the ideas slide back in).
function renderStage(opts) {
  opts = opts || {};
  const stage = document.getElementById('sgStage');
  if (!stage || !lastPlan) return;
  const st = slotState(lastPlan, curSlot()), u = ui(curSlot());
  const pinned = !!st.approved, items = st.items;
  u.idx = Math.min(u.idx, Math.max(0, items.length - 1));
  stage.dataset.pinned = pinned ? '1' : '0';
  stage.className = 'dk-stage' + (u.open ? ' open-card' : '') + (opts.enter ? ' enter-' + opts.enter : '');
  stage.innerHTML = items.length
    ? items.map((it, i) => cardHtml(it, i, items.length, pinned, i === (pinned ? 0 : u.idx), u)).join('')
    : `<p class="muted dk-empty">${esc(t('noSuggestions'))}</p>`;
  layoutCards(false);
  const first = pinned ? 0 : u.idx;
  if (opts.arrive && pinned) { const c = stage.querySelector('.dk-card'); if (c) c.classList.add('arrive'); }
  if (opts.cardsIn && !pinned) {
    stage.querySelectorAll('.dk-card').forEach((el, i) => {
      if (i === first) return;
      el.style.transition = 'none';
      el.style.transform = `translateX(${stage.clientWidth + 60}px) rotate(6deg)`;
      el.style.opacity = '0';
    });
    void stage.offsetWidth;
    layoutCards(true);
  }
  drawMealTimes();
}

// Opens a card in place, or closes it. Closing an edit takes the editor out of the card.
function setOpen(on) {
  const slot = curSlot(), u = ui(slot);
  if (u.open === on) return;
  u.open = on;
  if (!on && u.editing) { u.editing = false; u.draft = null; return renderStage(); }
  const stage = document.getElementById('sgStage');
  if (!stage) return;
  stage.classList.toggle('open-card', on);
  const el = stage.querySelector('.dk-card');
  if (el) el.classList.toggle('open', on);
  layoutCards(true);
}

function goTo(n) {
  const st = slotState(lastPlan, curSlot()), u = ui(curSlot());
  if (st.approved || u.open || n < 0 || n >= st.items.length || n === u.idx) return;
  u.idx = n;
  layoutCards(true);
}

// Runs after the Home screen is drawn: places the current meal's cards.
function initDeck() {
  if (!document.getElementById('sgStage')) return;
  const arrive = deck.arriveNext, cardsIn = deck.cardsInNext;
  deck.arriveNext = deck.cardsInNext = false;
  renderStage({ arrive, cardsIn });
}

// ----- the meal times bar: grows out of the Home tab, as in the approved mockup -----
function placeMealTimes(bar) {
  const home = document.querySelector('#nav [data-tab="home"]');
  if (!home) return;
  const hb = home.getBoundingClientRect();
  bar.style.setProperty('--hl', Math.round(hb.left) + 'px');
  bar.style.setProperty('--hw', Math.round(hb.width) + 'px');
  const last = bar.lastElementChild;
  if (last) bar.style.setProperty('--ow', (last.offsetLeft + last.offsetWidth + 5) + 'px');
}

function drawMealTimes() {
  const bar = document.getElementById('mtBar');
  if (!bar) return;
  const on = tab === 'home' && !!lastPlan && !!document.getElementById('sgStage');
  if (!lastPlan) return;
  bar.innerHTML = SLOTS.map((s, i) => `<button class="mt-sub${i === deck.cur ? ' on' : ''}${slotState(lastPlan, s).approved ? ' done' : ''}" data-dk-slot="${i}" role="tab" aria-selected="${i === deck.cur}">${esc(t(s))}</button>`).join('');
  placeMealTimes(bar);
  if (on && !bar.classList.contains('show')) {
    requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.add('show')));
  } else if (!on) {
    bar.classList.remove('show');
  }
}

// ----- the Home screen data -----
let lastPlan = null;

function homeTimes() {
  const hour = new Date().getHours();
  return {
    greeting: hour < 12 ? t('greetMorning') : hour < 18 ? t('greetAfternoon') : t('greetEvening'),
    niceDate: new Date().toLocaleDateString(t('dateLocale'), { weekday: 'long', day: 'numeric', month: 'long' }),
  };
}

// Draws the Home screen from the data on screen, straight away, without waiting for the database.
function redrawHome() {
  if (!lastPlan || tab !== 'home') return;
  const { greeting, niceDate } = homeTimes();
  cache.playIntro = false;
  cache.screenHtml = familyHomeHtml(lastPlan, greeting, niceDate);
  cache.homeParts = deckParts(lastPlan);     // the database's echo of this change is then seen as no change
  render();
}

function setLocalStatus(id, status) {
  const m = lastPlan && lastPlan.meals.find((x) => x.id === id);
  if (m) m.status = status;
}

// Saves a meal change made on screen. If the save fails, the screen goes back to what it was and says why.
function saveMeal(id, fields, revert) {
  return sb.from('meals').update(fields).eq('id', id).then(({ error }) => {
    if (!error) return true;
    revert();
    redrawHome();
    setProblem(error);
    return false;
  });
}

// Approve: the other ideas slide away, the approved card is pinned, then the screen is drawn from the new data.
// The save runs alongside the animation, so the card doesn't wait for the database.
function sgApprove(mealId) {
  if (deckBusy) return;
  const stage = document.getElementById('sgStage');
  const card = stage && stage.querySelector(`[data-dk-card="${mealId}"]`);
  if (!card) return;
  deckBusy = true;
  if (navigator.vibrate) navigator.vibrate(12);   // a short tap of feedback on Android
  const m = lastPlan && lastPlan.meals.find((x) => x.id === mealId);
  const was = m ? m.status : 'suggested';
  const u = ui(curSlot());
  u.open = false; u.editing = false; u.draft = null;
  setLocalStatus(mealId, 'approved');
  saveMeal(mealId, { status: 'approved' }, () => setLocalStatus(mealId, was));

  stage.classList.remove('open-card');
  const cards = [...stage.querySelectorAll('.dk-card')];
  const pin = cards.indexOf(card);
  cards.forEach((c, i) => {
    if (c === card) return;
    c.style.transition = 'transform .42s cubic-bezier(.5,0,.75,0), opacity .3s ease';
    c.style.transitionDelay = (Math.abs(i - pin) * 60) + 'ms';
    c.style.transform = 'translateX(120%) rotate(8deg)';
    c.style.opacity = '0';
  });
  const none = document.getElementById('sgNoneRow');
  if (none) none.classList.add('hide');
  setTimeout(() => {
    deck.arriveNext = true;
    redrawHome();
    deckBusy = false;
  }, motion('--sg-approve-ms', 460));
}

// Change: the approved meal goes back among the ideas, and they slide back in.
function sgChange(mealId) {
  if (deckBusy) return;
  const m = lastPlan && lastPlan.meals.find((x) => x.id === mealId);
  const was = m ? m.status : 'approved';
  setLocalStatus(mealId, 'suggested');
  deck.cardsInNext = true;
  redrawHome();
  saveMeal(mealId, { status: 'suggested' }, () => setLocalStatus(mealId, was));
}

// Use this (from "None of these?"): the picked recipe is approved straight away. It gets a temporary id until the database gives it a real one.
async function sgUse(recipeId, slot) {
  if (!lastPlan) return;
  closeSheet();
  const tmp = 'tmp-' + Date.now();
  lastPlan.meals.push({ id: tmp, meal_slot: slot, status: 'approved', recipe_id: recipeId, servings: 4, recipes: null });
  deck.arriveNext = true;
  redrawHome();
  const { data, error } = await sb.from('meals').insert({
    household_id: hh.id,
    created_by: session.user.id,
    meal_date: todayIso(),
    meal_slot: slot,
    recipe_id: recipeId,
    servings: 4,
    status: 'approved',
  }).select('id').single();
  const m = lastPlan.meals.find((x) => x.id === tmp);
  if (error) {
    if (m) lastPlan.meals.splice(lastPlan.meals.indexOf(m), 1);
    redrawHome();
    return setProblem(error);
  }
  if (m) m.id = data.id;
  redrawHome();
}

// ----- the picker behind "None of these?", which slides up over the meal's card -----
function openSheet() {
  const slot = curSlot();
  const sheet = document.getElementById('sgSheet');
  if (!sheet) return;
  const rows = slotRecipes(slot);
  sheet.innerHTML = `<h4>${esc(t('dkChooseTitle'))}</h4><div class="dk-list">${rows.length ? rows.map((r) => {
      const name = nameOf(r.title_en, r.title_ar);
      return `<div class="dk-pick">
        <span class="dk-thumb" style="background:${colorFor(r.id)}">${esc((name || '?').trim().charAt(0).toUpperCase())}</span>
        <div class="dk-pick-main"><strong>${esc(name)}</strong><small>${r.minutes} min</small>${kindChipHtml(r)}</div>
        <button type="button" class="dk-btn small" data-dk-use="${r.id}" data-slot="${slot}">${esc(t('useThis'))}</button>
      </div>`;
    }).join('') : `<p class="muted">${esc(t('noRecipes'))}</p>`}</div>
    <button type="button" class="dk-btn ghost dk-wide" data-dk-act="close-sheet">${esc(t('cancel'))}</button>`;
  sheet.setAttribute('aria-hidden', 'false');
  void sheet.offsetWidth;
  sheet.classList.add('open');
  // While the picker is up, the restock pill is off: its card would otherwise open behind the picker.
  document.querySelectorAll('.restock-wrap.open').forEach((w) => w.classList.remove('open'));
  const stage = document.getElementById('homeStage');
  if (stage) stage.classList.add('picking');
}
function closeSheet() {
  const sheet = document.getElementById('sgSheet');
  if (!sheet) return;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  const stage = document.getElementById('homeStage');
  if (stage) stage.classList.remove('picking');
}

// ----- editing a card: name, minutes and ingredient names, saved to the recipe -----
function startEdit() {
  const u = ui(curSlot()), st = slotState(lastPlan, curSlot());
  const item = st.items[st.approved ? 0 : u.idx];
  if (!item || !item.r) return;
  const r = item.r;
  u.draft = {
    title: nameOf(r.title_en, r.title_ar),
    min: r.minutes,
    ings: r.ings.map((g) => ({ id: g.id, name: nameOf(g.name_en, g.name_ar), orig: nameOf(g.name_en, g.name_ar) })),
  };
  u.editing = true;
  u.open = true;
  renderStage();
}
function cancelEdit() {
  const u = ui(curSlot());
  u.editing = false; u.draft = null;
  renderStage();
}

// Saves the edit: the card shows it at once, then the recipe and its ingredients are written.
async function saveEdit() {
  const slot = curSlot(), u = ui(slot), st = slotState(lastPlan, slot);
  const item = st.items[st.approved ? 0 : u.idx], d = u.draft;
  if (!item || !item.r || !d) return;
  const r = item.r;
  const k = lang === 'ar' ? '_ar' : '_en';
  const title = d.title.trim() || nameOf(r.title_en, r.title_ar);
  const min = Math.min(240, Math.max(5, +d.min || r.minutes));
  const keep = d.ings.filter((g) => g.name.trim());
  const removed = r.ings.filter((g) => !keep.some((x) => x.id === g.id)).map((g) => g.id);
  const renamed = keep.filter((g) => g.id && g.name.trim() !== g.orig);
  const added = keep.filter((g) => !g.id);
  const titleChanged = title !== nameOf(r.title_en, r.title_ar) || min !== r.minutes;

  r['title' + k] = title;
  r.minutes = min;
  r.ings = keep.map((g) => {
    const o = r.ings.find((x) => x.id === g.id);
    if (o) return { ...o, ['name' + k]: g.name.trim() };
    return { id: null, ingredient_key: g.name.trim().toLowerCase(), name_en: g.name.trim(), name_ar: g.name.trim(), quantity: '', optional: false };
  });
  u.editing = false; u.draft = null;
  renderStage();

  const ops = [];
  if (titleChanged) ops.push(sb.from('recipes').update({ ['title' + k]: title, minutes: min }).eq('id', r.id));
  if (removed.length) ops.push(sb.from('recipe_ingredients').delete().in('id', removed));
  renamed.forEach((g) => ops.push(sb.from('recipe_ingredients').update({ ['name' + k]: g.name.trim() }).eq('id', g.id)));
  if (added.length) ops.push(sb.from('recipe_ingredients').insert(added.map((g) => ({
    recipe_id: r.id,
    ingredient_key: g.name.trim().toLowerCase(),
    name_en: g.name.trim(),
    name_ar: g.name.trim(),
    quantity: '',
    optional: false,
  }))));
  const results = await Promise.all(ops);
  const err = results.map((x) => x.error).find(Boolean);
  if (err) setProblem(err);
  await loadTab({ quiet: true });
}

// The buttons on the cards and the sheet. One listener on the page, so it survives redraws.
function deckAct(btn) {
  const a = btn.dataset.dkAct, u = ui(curSlot());
  if (a === 'approve') return sgApprove(btn.dataset.id);
  if (a === 'change') return sgChange(btn.dataset.id);
  if (a === 'edit') return startEdit();
  if (a === 'close') return setOpen(false);
  if (a === 'save') return saveEdit();
  if (a === 'cancel-edit') return cancelEdit();
  if (a === 'add-ing') {
    if (!u.draft) return;
    u.draft.ings.push({ id: null, name: t('dkNewIng'), orig: '' });
    renderStage();
    const ins = document.querySelectorAll('#sgStage [data-dk-ing]');
    if (ins.length) ins[ins.length - 1].focus();
    return;
  }
  if (a === 'rm') { if (u.draft) { u.draft.ings.splice(+btn.dataset.i, 1); renderStage(); } return; }
  if (a === 'choose') return openSheet();
  if (a === 'close-sheet') return closeSheet();
}

document.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; if (e.target.closest('#sgStage')) return; }
  const mt = e.target.closest('#mtBar [data-dk-slot]');
  if (mt) return pickSlot(Number(mt.dataset.dkSlot));
  const act = e.target.closest('[data-dk-act]');
  if (act) return deckAct(act);
  const use = e.target.closest('[data-dk-use]');
  if (use) return sgUse(use.dataset.dkUse, use.dataset.slot);
  // A tap on a card: the front one opens; one behind comes to the front.
  const card = e.target.closest('#sgStage .dk-card');
  if (card && !e.target.closest('button, input, textarea, label')) {
    const slot = curSlot(), u = ui(slot), st = slotState(lastPlan, slot);
    if (st.approved) { if (!u.open) setOpen(true); return; }
    if (u.open) return;
    const k = [...document.querySelectorAll('#sgStage .dk-card')].indexOf(card);
    if (k === u.idx) setOpen(true);
    else goTo(k);
  }
});

// The meal times: switching slides the cards in from the side the new meal is on.
function pickSlot(k) {
  if (k === deck.cur || deckBusy || !lastPlan) return;
  const dir = k > deck.cur ? 'r' : 'l';
  deck.cur = k;
  closeSheet();
  renderStage({ enter: dir });
}

// Drags: a sideways drag moves through the ideas for this meal (one card per swipe), and the row
// follows the finger. Sideways drags on an open card are not taken, so the card can scroll.
let drag = null;
document.addEventListener('pointerdown', (e) => {
  const stage = document.getElementById('sgStage');
  if (!stage || !stage.contains(e.target)) return;
  suppressClick = false;
  if (e.target.closest('button, input, textarea, select, label')) return;   // taps and typing on a card's own controls
  const u = ui(curSlot());
  if (stage.dataset.pinned === '1' || u.open || deckBusy || !lastPlan) return;
  drag = { x0: e.clientX, id: e.pointerId, moved: false, dx: 0 };
});
document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0;
  if (!drag.moved && Math.abs(dx) > 8) drag.moved = true;
  if (!drag.moved) return;
  const u = ui(curSlot()), n = slotState(lastPlan, curSlot()).items.length;
  const atEnd = (dx > 0 && u.idx === 0) || (dx < 0 && u.idx === n - 1);
  drag.dx = dx;
  layoutCards(false, null, atEnd ? dx * 0.3 : dx);
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const d = drag;
  drag = null;
  if (!d.moved) return;
  suppressClick = true;
  const u = ui(curSlot()), n = slotState(lastPlan, curSlot()).items.length;
  if (d.dx < -50 && u.idx < n - 1) u.idx++;
  else if (d.dx > 50 && u.idx > 0) u.idx--;
  layoutCards(true);
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

// Typing in the editor keeps the draft up to date.
document.addEventListener('input', (e) => {
  const u = ui(curSlot());
  if (!u.draft || !e.target.closest || !e.target.closest('#sgStage')) return;
  const f = e.target.dataset.dkF, ing = e.target.dataset.dkIng;
  if (f === 'title') u.draft.title = e.target.value;
  if (f === 'min') u.draft.min = e.target.value;
  if (ing !== undefined && u.draft.ings[+ing]) u.draft.ings[+ing].name = e.target.value;
});

window.addEventListener('resize', () => { layoutCards(false); });
