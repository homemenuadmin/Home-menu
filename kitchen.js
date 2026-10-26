// Kitchen tab: fridge, freezer and pantry, each with its own items and add button.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// KITCHEN: stock
// ---------------------------------------------------------------
const LEVELS = ['Full', 'Half', 'Low', 'Finished'];
const LOCATIONS = ['fridge', 'freezer', 'pantry'];
// itemForm (from core.js) is false, or the location a new item is being added to.

async function screenKitchen() {
  const { data, error } = await sb
    .from('pantry_items')
    .select('id, name_en, name_ar, ingredient_key, location, level')
    .eq('household_id', hh.id)
    .order('name_en');
  if (error) throw error;
  cache.items = data || [];
  const editable = can.stock();

  let html = `<p>${esc(editable ? roleNote() : t('readOnlyKitchen'))}</p>`;
  if (!cache.items.length) html += `<div class="card"><p>${esc(t('emptyKitchen'))}</p></div>`;

  // Every section always shows, so an empty place can be filled straight away.
  for (const loc of LOCATIONS) {
    const list = cache.items.filter((i) => i.location === loc);
    html += `<h2>${esc(t(loc))} <span class="tag">${list.length}</span></h2><div class="card" data-loc="${loc}">`;
    if (!list.length) html += `<p class="muted empty-note">${esc(t('emptySection'))}</p>`;
    else html += '<ul class="clean">';
    for (const it of list) {
      const levels = editable
        ? LEVELS.map((l) => `<button class="chip ${it.level === l ? 'on' : ''}" onclick="setLevel('${it.id}','${l}')">${esc(t(l))}</button>`).join('')
        : `<span class="tag">${esc(t(it.level))}</span>`;
      const del = editable ? `<button class="btn small danger" onclick="removeItem('${it.id}')">${esc(t('deleteItem'))}</button>` : '';
      html += `<li><div class="row"><strong>${esc(nameOf(it.name_en, it.name_ar))}</strong>${del}</div><div>${levels}</div></li>`;
    }
    if (list.length) html += '</ul>';

    if (editable) {
      if (itemForm === loc) html += itemFormHtml(loc);
      else html += `<button class="btn small add-slot" onclick="toggleItemForm('${loc}')">${esc(t('addItem'))}</button>`;
    }
    html += '</div>';
  }
  return html;
}

// The add-item form for one location. It takes the place of the add button.
function itemFormHtml(loc) {
  return `<div class="fold${foldEnter('item-' + loc)}" data-fold="item-${loc}"><div class="item-form">
          <h3 style="margin-top:0">${esc(t('addItem'))} · ${esc(t(loc))}</h3>
          <label>${esc(t('itemName'))}</label><input id="iname">
          <label>${esc(t('itemNameAr'))}</label><input id="iname_ar">
          <label>${esc(t('itemKey'))}</label><input id="ikey">
          <label>${esc(t('level'))}</label>
          <select id="ilevel">${LEVELS.map((l) => `<option value="${l}">${esc(t(l))}</option>`).join('')}</select>
          <button class="btn" onclick="saveItem()">${esc(t('save'))}</button>
          <button class="btn secondary" onclick="toggleItemForm(false)">${esc(t('cancel'))}</button>
        </div></div>`;
}

// Opens the add form for one location in place, at once. Or closes it when false is passed.
function toggleItemForm(loc) {
  if (loc) {
    itemForm = loc;
    const opened = openFormNow('item-' + loc, () => {
      const card = document.querySelector(`[data-loc="${loc}"]`);
      const btn = card && card.querySelector('.add-slot');
      if (!btn) return null;
      return { els: [btn], hide: [card.querySelector('.empty-note')].filter(Boolean) };
    }, itemFormHtml(loc));
    if (!opened) loadTab({ quiet: true });
    return;
  }
  if (!itemForm) return;
  closeFormNow('item-' + itemForm, () => { itemForm = false; });
}

async function saveItem() {
  const name = document.getElementById('iname').value.trim();
  if (!name) return setProblem(new Error(t('itemName')));
  const key = (document.getElementById('ikey').value.trim() || name).toLowerCase();
  const { error } = await sb.from('pantry_items').insert({
    household_id: hh.id,
    name_en: name,
    name_ar: document.getElementById('iname_ar').value.trim() || null,
    ingredient_key: key,
    location: itemForm,
    level: document.getElementById('ilevel').value,
    updated_by: session.user.id,
  });
  if (error) return setProblem(error);
  closeFormNow('item-' + itemForm, () => { itemForm = false; notice = t('ok'); problem = ''; }, () => loadTab({ quiet: true }));
}

async function setLevel(id, level) {
  const { error } = await sb.from('pantry_items')
    .update({ level, updated_by: session.user.id, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return setProblem(error);
  await loadTab({ quiet: true });
}

async function removeItem(id) {
  if (!confirm(t('confirmDeleteItem'))) return;
  const { error } = await sb.from('pantry_items').delete().eq('id', id);
  if (error) return setProblem(error);
  await loadTab({ quiet: true });
}
