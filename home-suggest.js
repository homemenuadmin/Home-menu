// Home suggestions for the family, laid out as in the approved mockup (Mock-ups/home-suggestions-mockup.html):
// a row of meal cards to swipe between, each with a stack of ideas. Approve sends the others away and pins the
// approved meal; "None of these?" opens the picker. Ideas come from the household's recipes (ready ones first)
// and, in the background, from the AI, which is asked for dishes that use what is in the kitchen.
// Part of Home Menu. Loaded by index.html after home.js.

const aiAsked = new Set();                 // AI ideas asked for in this page visit, so a failed request isn't repeated
const deck = { cur: 0, front: {} };        // the meal card in front, and which idea is in front of each meal
let deckBusy = false;                      // an approve is in progress
let deckRO = null;                         // keeps the stacks the right size
let slideDrag = null;                      // a sideways drag between meal cards
let listDrag = null;                       // a drag over a stack, to move through it
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

function colorFor(id) {
  return PICK_COLORS[[...String(id)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % PICK_COLORS.length];
}

function readyTagHtml(r) {
  if (r.source === 'ai') return `<span class="sg-tag ai">${esc(t('aiIdea'))}</span>`;
  return r.ready
    ? `<span class="sg-tag ok">${esc(t('haveEverything'))}</span>`
    : `<span class="sg-tag warn">${esc(t('missing'))} ${r.missing}</span>`;
}

// One idea in the deck. Its ingredients are the real editor's rows, so Edit works as it does in the picker.
function cardHtml(item, pinned) {
  const { meal: m, r } = item;
  const name = r ? nameOf(r.title_en, r.title_ar) : (m.recipes ? nameOf(m.recipes.title_en, m.recipes.title_ar) : '');
  const letter = esc((name || '?').trim().charAt(0).toUpperCase());
  const color = colorFor(r ? r.id : m.recipe_id || m.id);
  const desc = r && r.desc ? `<p class="sg-desc">${esc(r.desc)}</p>` : '';
  const body = r
    ? `${ingHeadHtml(r)}<ul class="clean pick-ings">${r.ings.map((i, idx) => ingLiHtml(i, idx)).join('')}</ul>${ingAddHtml(r)}`
    : '';
  const footer = pinned
    ? (r ? `<button class="sg-toggle" data-sg-toggle><span class="when-read">${esc(t('ingredients'))}</span><span class="when-edit">${esc(t('done'))}</span></button>` : '')
    : `<button class="btn sg-approve" data-sg-approve="${m.id}">${esc(t('approve'))}</button>`;
  return `<div class="pick-item sg-card${pinned ? ' pinned' : ''}" data-sg-card="${m.id}"${r ? ` data-pick="${r.id}"` : ''}>
    <div class="sg-img" style="background:${color}">
      <button class="sg-back" data-sg-close>‹ ${esc(t('back'))}</button>
      <button class="sg-back sg-change" data-sg-change="${m.id}">${esc(t('changeMeal'))}</button>
      <span class="sg-letter" aria-hidden="true">${letter}</span>
    </div>
    <div class="sg-body">
      <div class="sg-top"><strong>${esc(name)}</strong>${r ? `<small>${r.minutes} min</small>` : ''}</div>
      ${r ? readyTagHtml(r) : ''}
      ${desc}
      <div class="pick-details"><div class="pick-details-inner sg-more">${body}</div></div>
      ${footer}
    </div>
  </div>`;
}

// The picker "None of these?" opens inside the meal card: every recipe for the meal, with Use this.
function pickerHtml(slot) {
  const rows = slotRecipes(slot);
  const list = rows.length
    ? rows.map((r) => `<div class="sg-pick-row">
        <span class="sg-pick-thumb" style="background:${colorFor(r.id)}">${esc((nameOf(r.title_en, r.title_ar) || '?').trim().charAt(0).toUpperCase())}</span>
        <div class="sg-row-main"><strong>${esc(nameOf(r.title_en, r.title_ar))}</strong><small>${r.minutes} min</small>${readyTagHtml(r)}</div>
        <button class="btn small" data-sg-use="${r.id}" data-slot="${slot}">${esc(t('useThis'))}</button>
      </div>`).join('')
    : `<p class="muted">${esc(t('noRecipes'))}</p>`;
  return `<div class="sg-pick-list">${list}</div>
    <button class="btn secondary sg-cancel" data-sg-close-picker>${esc(t('cancel'))}</button>`;
}

function slotHtml(st) {
  const cards = st.items.map((it) => cardHtml(it, !!st.approved)).join('');
  const empty = st.items.length ? '' : `<p class="muted sg-empty">${esc(t('noSuggestions'))}</p>`;
  const status = st.approved
    ? `<span class="status ok">${esc(t('approved'))}</span>`
    : `<span class="status">${esc(t('suggested'))}</span>`;
  const pill = st.approved ? '' : `<button class="sg-pill" data-sg-pick aria-expanded="false">${esc(t('noneOfThese'))}</button>`;
  return `<section class="sg-slot${st.approved ? ' approved' : ''}" data-sg-slot="${st.slot}">
    <div class="sg-head"><h3>${esc(t(st.slot))}</h3>${status}</div>
    <div class="sg-list">${cards}${empty}</div>
    ${pill}
    <div class="sg-picker"><div class="sg-picker-box">${pickerHtml(st.slot)}</div></div>
  </section>`;
}

// The meal cards in a row, with dots under them, as in the mockup.
function deckHtml(plan) {
  const slots = SLOTS.map((slot) => slotHtml(slotState(plan, slot))).join('');
  const dots = SLOTS.map((s, i) => `<button data-sg-go="${i}" aria-label="${esc(t(s))}"></button>`).join('');
  return `<div class="sg-deck" id="sgDeck">${slots}</div>
    <div class="sg-dots" id="sgDots">${dots}</div>
    <p class="sg-hint">${esc(t('sgHint'))}</p>`;
}

// Places the meal cards in the row: the current one in front, its neighbours smaller and behind.
function layoutDeck() {
  const el = document.getElementById('sgDeck');
  if (!el) return;
  const w = el.clientWidth || 1;
  const px = slideDrag ? slideDrag.px : 0;
  el.querySelectorAll('.sg-slot').forEach((s, i) => {
    const off = i - deck.cur - px / w;
    const a = Math.abs(off);
    s.style.transform = `translateX(-50%) translateX(${off * 62}%) scale(${Math.max(0.78, 1 - a * 0.14)}) rotateY(${-off * 14}deg)`;
    s.style.zIndex = String(20 - Math.round(a * 10));
    s.style.opacity = a > 1.7 ? '0' : String(Math.max(0.35, 1 - a * 0.35));
    s.classList.toggle('current', Math.round(off) === 0);
  });
  document.querySelectorAll('#sgDots button').forEach((d, k) => d.classList.toggle('on', k === deck.cur));
}

// Places each meal's ideas: a stack with the front one full size, the others as edges behind it.
// An approved meal shows as one pinned card. An open card fills the stack.
function paintStacks() {
  document.querySelectorAll('#sgDeck .sg-list').forEach((list) => {
    const section = list.closest('.sg-slot');
    const cards = [...list.querySelectorAll('.sg-card')];
    const H = list.clientHeight;
    if (!cards.length || !H) return;
    const cardH = Math.max(200, H - 72);
    const open = cards.find((c) => c.classList.contains('open'));

    if (section.classList.contains('approved')) {
      cards.forEach((c) => {
        const isOpen = c === open;
        c.style.top = isOpen ? '0px' : '20px';
        c.style.height = (isOpen ? H : cardH) + 'px';
        c.style.transform = 'none';
        c.style.opacity = '1';
        c.style.zIndex = '30';
        c.classList.add('front');
      });
      return;
    }

    const front = Math.min(deck.front[section.dataset.sgSlot] || 0, cards.length - 1);
    cards.forEach((c, i) => {
      const k = i - front, a = Math.abs(k);
      c.classList.toggle('front', a === 0);
      if (open) {
        c.style.top = c === open ? '0px' : '20px';
        c.style.height = (c === open ? H : cardH) + 'px';
        c.style.transform = 'none';
        c.style.opacity = c === open ? '1' : '0';
        c.style.zIndex = c === open ? '30' : '1';
        return;
      }
      c.style.height = cardH + 'px';
      c.style.top = (20 + k * 16) + 'px';
      c.style.transform = `scale(${Math.max(0.8, 1 - a * 0.05)})`;
      c.style.opacity = a > 3 ? '0' : String(1 - a * 0.22);
      c.style.zIndex = String(20 - a);
    });
  });
}

// The picker grows out of the "None of these?" pill into the meal card, as in the mockup.
// Geometry is measured from the card's inside edge; the picker starts where the pill is, then grows.
function pillGeom(section) {
  const sl = section.getBoundingClientRect();
  const pb = section.querySelector('.sg-pill').getBoundingClientRect();
  return { left: pb.left - sl.left - section.clientLeft, top: pb.top - sl.top - section.clientTop, width: pb.width, height: pb.height };
}
function finalGeom(section) {
  const head = section.querySelector('.sg-head');
  const top = head.offsetTop + head.offsetHeight + 8;
  return { left: 0, top, width: section.clientWidth, height: section.clientHeight - top };
}
function setGeom(section, g) {
  const p = section.querySelector('.sg-picker');
  p.style.left = g.left + 'px';
  p.style.top = g.top + 'px';
  p.style.width = g.width + 'px';
  p.style.height = g.height + 'px';
}
function openPicker(section) {
  const p = section.querySelector('.sg-picker');
  p.style.transition = 'none';
  setGeom(section, pillGeom(section));
  void p.offsetHeight;          // let the browser draw the pill's shape before it grows
  p.style.transition = '';
  section.classList.add('picking');
  section.querySelector('.sg-pill').setAttribute('aria-expanded', 'true');
  setGeom(section, finalGeom(section));
}
function closePicker(section) {
  if (!section) return;
  setGeom(section, pillGeom(section));
  section.classList.remove('picking');
  section.querySelector('.sg-pill').setAttribute('aria-expanded', 'false');
}

function stepStack(section, dir) {
  const list = section.querySelector('.sg-list');
  if (list.querySelector('.sg-card.open')) return;
  const n = list.querySelectorAll('.sg-card').length;
  const key = section.dataset.sgSlot;
  const next = Math.max(0, Math.min(n - 1, (deck.front[key] || 0) + dir));
  if (next === (deck.front[key] || 0)) return;
  deck.front[key] = next;
  paintStacks();
}

// Runs after the Home screen is drawn: lays out the deck and keeps the stacks sized to their lists.
function initDeck() {
  const el = document.getElementById('sgDeck');
  if (!el) return;
  layoutDeck();
  paintStacks();
  if (deckRO) deckRO.disconnect();
  deckRO = new ResizeObserver(() => paintStacks());
  el.querySelectorAll('.sg-list').forEach((l) => deckRO.observe(l));
  // A mouse wheel or trackpad moves one card per gesture, the same as a swipe, and never scrolls the page.
  let wheelLock = false;
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (wheelLock || e.target.closest('.sg-picker')) return;
    const dy = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : 0;
    const dx = dy === 0 ? e.deltaX : 0;
    if (!dx && !dy) return;
    wheelLock = true;
    setTimeout(() => { wheelLock = false; }, 380);
    const list = e.target.closest('.sg-list');
    if (list && dy) return stepStack(list.closest('.sg-slot'), dy > 0 ? 1 : -1);
    if (dx) slideTo(deck.cur + (dx > 0 ? 1 : -1));
  }, { passive: false });
}

// Approve: the other ideas slide away, one after another, then the approved meal is pinned.
function sgApprove(mealId) {
  if (deckBusy) return;
  const card = document.querySelector(`[data-sg-card="${mealId}"]`);
  if (!card) return;
  deckBusy = true;
  const list = card.closest('.sg-list');
  const cards = [...list.querySelectorAll('.sg-card')];
  const pinIdx = cards.indexOf(card);
  cards.forEach((c, i) => {
    if (c === card) return;
    c.style.transitionDelay = (Math.abs(i - pinIdx) * 60) + 'ms';
    c.style.transform = 'translateX(-130%) rotate(-6deg)';
    c.style.opacity = '0';
  });
  card.style.top = '0px';
  card.style.height = list.clientHeight + 'px';
  card.style.transform = 'none';
  card.style.zIndex = '30';
  setTimeout(async () => {
    await setMealStatus(mealId, 'approved');
    deckBusy = false;
  }, motion('--sg-approve-ms', 480));
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

// Clicks on the deck. One listener on the page, so it survives redraws.
document.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; if (e.target.closest('#sgDeck')) return; }
  const go = e.target.closest('[data-sg-go]');
  if (go) return slideTo(Number(go.dataset.sgGo));
  const slot = e.target.closest('.sg-slot');
  if (slot && !slot.classList.contains('current') && e.target.closest('#sgDeck') && !e.target.closest('button, input, li')) {
    return slideTo([...document.querySelectorAll('#sgDeck .sg-slot')].indexOf(slot));
  }
  const pick = e.target.closest('[data-sg-pick]');
  if (pick) return openPicker(pick.closest('.sg-slot'));
  if (e.target.closest('[data-sg-close-picker]')) return closePicker(e.target.closest('.sg-slot'));
  const approve = e.target.closest('[data-sg-approve]');
  if (approve) return sgApprove(approve.dataset.sgApprove);
  const change = e.target.closest('[data-sg-change]');
  if (change) return setMealStatus(change.dataset.sgChange, 'suggested');
  const use = e.target.closest('[data-sg-use]');
  if (use) return sgUse(use.dataset.sgUse, use.dataset.slot);
  const toggle = e.target.closest('[data-sg-toggle]');
  if (toggle) {
    toggle.closest('.sg-card').classList.toggle('open');
    return paintStacks();
  }
  const close = e.target.closest('[data-sg-close]');
  if (close) {
    close.closest('.sg-card').classList.remove('open');
    return paintStacks();
  }
  // A tap on a card: the front one opens, one behind comes to the front.
  const card = e.target.closest('.sg-card');
  if (card && !e.target.closest('button, input, li, textarea, select') && !card.classList.contains('pinned')) {
    const section = card.closest('.sg-slot');
    const list = section.querySelector('.sg-list');
    if (list.querySelector('.sg-card.open')) return;
    const idx = [...list.querySelectorAll('.sg-card')].indexOf(card);
    if (card.classList.contains('front')) {
      card.classList.add('open');
      return paintStacks();
    }
    deck.front[section.dataset.sgSlot] = idx;
    paintStacks();
  }
});

function slideTo(i) {
  const n = document.querySelectorAll('#sgDeck .sg-slot').length;
  deck.cur = Math.max(0, Math.min(n - 1, i));
  slideDrag = null;
  layoutDeck();
}

// Drags: sideways moves between meal cards; up or down over a stack moves through its ideas.
document.addEventListener('pointerdown', (e) => {
  const el = document.getElementById('sgDeck');
  if (!el || !el.contains(e.target)) return;
  suppressClick = false;   // a drag that ends without a click must not swallow the next tap
  // A drag may start on a button or ingredient row (a tap there still counts as a tap); typing and the picker's list don't.
  if (e.target.closest('input, textarea, select, .sg-picker')) return;
  const list = e.target.closest('.sg-list');
  if (list && !list.querySelector('.sg-card.open')) listDrag = { list, y0: e.clientY };
  slideDrag = { x0: e.clientX, y0: e.clientY, px: 0, on: false, moved: false, el };
});
document.addEventListener('pointermove', (e) => {
  if (!slideDrag) return;
  const dx = e.clientX - slideDrag.x0, dy = e.clientY - slideDrag.y0;
  if (!slideDrag.on && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
    slideDrag.on = true;
    slideDrag.moved = true;
    slideDrag.el.classList.add('dragging');
  }
  if (slideDrag.on) { slideDrag.px = dx; layoutDeck(); }
});
document.addEventListener('pointerup', (e) => {
  if (listDrag) {
    const dy = e.clientY - listDrag.y0;
    if (Math.abs(dy) > 30) {
      suppressClick = true;
      stepStack(listDrag.list.closest('.sg-slot'), dy < 0 ? 1 : -1);
    }
    listDrag = null;
  }
  if (!slideDrag) return;
  const d = slideDrag;
  slideDrag = null;
  if (!d.on) return;
  d.el.classList.remove('dragging');
  suppressClick = true;
  // One meal card at a time: a swipe past a fifth of the width moves one card, anything less goes back.
  const w = d.el.clientWidth || 1;
  if (Math.abs(d.px) > w * 0.2) slideTo(deck.cur + (d.px < 0 ? 1 : -1));
  else layoutDeck();
});
window.addEventListener('resize', () => { layoutDeck(); paintStacks(); });
