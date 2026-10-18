// Kitchen tab: stock by location.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// KITCHEN: stock
// ---------------------------------------------------------------
const LEVELS = ['Full', 'Half', 'Low', 'Finished'];
const LOCATIONS = ['fridge', 'freezer', 'pantry'];

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

  for (const loc of LOCATIONS) {
    const list = cache.items.filter((i) => i.location === loc);
    if (!list.length) continue;
    html += `<h2>${esc(t(loc))}</h2><div class="card"><ul class="clean">`;
    for (const it of list) {
      const levels = editable
        ? LEVELS.map((l) => `<button class="chip ${it.level === l ? 'on' : ''}" onclick="setLevel('${it.id}','${l}')">${esc(t(l))}</button>`).join('')
        : `<span class="tag">${esc(t(it.level))}</span>`;
      const del = editable ? `<button class="btn small danger" onclick="removeItem('${it.id}')">${esc(t('deleteItem'))}</button>` : '';
      html += `<li><div class="row"><strong>${esc(nameOf(it.name_en, it.name_ar))}</strong>${del}</div><div>${levels}</div></li>`;
    }
    html += '</ul></div>';
  }

  if (editable) {
    if (itemForm) {
      html += `<div class="card"><h2 style="margin-top:0">${esc(t('addItem'))}</h2>
        <label>${esc(t('itemName'))}</label><input id="iname">
        <label>${esc(t('itemNameAr'))}</label><input id="iname_ar">
        <label>${esc(t('itemKey'))}</label><input id="ikey">
        <label>${esc(t('location'))}</label>
        <select id="iloc">${LOCATIONS.map((l) => `<option value="${l}">${esc(t(l))}</option>`).join('')}</select>
        <label>${esc(t('level'))}</label>
        <select id="ilevel">${LEVELS.map((l) => `<option value="${l}">${esc(t(l))}</option>`).join('')}</select>
        <button class="btn" onclick="saveItem()">${esc(t('save'))}</button>
        <button class="btn secondary" onclick="toggleItemForm(false)">${esc(t('cancel'))}</button></div>`;
    } else {
      html += `<button class="btn" onclick="toggleItemForm(true)">${esc(t('addItem'))}</button>`;
    }
  }
  return html;
}

async function toggleItemForm(on) { itemForm = on; await loadTab(); }

async function saveItem() {
  const name = document.getElementById('iname').value.trim();
  if (!name) return setProblem(new Error(t('itemName')));
  const key = (document.getElementById('ikey').value.trim() || name).toLowerCase();
  const { error } = await sb.from('pantry_items').insert({
    household_id: hh.id,
    name_en: name,
    name_ar: document.getElementById('iname_ar').value.trim() || null,
    ingredient_key: key,
    location: document.getElementById('iloc').value,
    level: document.getElementById('ilevel').value,
    updated_by: session.user.id,
  });
  if (error) return setProblem(error);
  itemForm = false;
  setNotice(t('ok'));
  await loadTab();
}

async function setLevel(id, level) {
  const { error } = await sb.from('pantry_items')
    .update({ level, updated_by: session.user.id, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return setProblem(error);
  await loadTab();
}

async function removeItem(id) {
  if (!confirm(t('confirmDeleteItem'))) return;
  const { error } = await sb.from('pantry_items').delete().eq('id', id);
  if (error) return setProblem(error);
  await loadTab();
}
