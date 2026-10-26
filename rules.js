// Rules tab: dos and don'ts.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// RULES: dos and don'ts
// ---------------------------------------------------------------
// The columns a saved rule is read back with, so it can be shown at once.
const RULE_SELECT = 'id, kind, text_en, text_ar, ingredient_key';
// One rule's row in its group.
function ruleRowHtml(r, editable) {
  const del = editable ? `<button class="btn small danger" onclick="removeRule('${r.id}')">${esc(t('deleteRule'))}</button>` : '';
  return `<li><div class="row"><span>${esc(nameOf(r.text_en, r.text_ar))}</span>${del}</div></li>`;
}

async function screenRules() {
  const { data, error } = await sb
    .from('rules')
    .select('id, kind, text_en, text_ar, ingredient_key')
    .eq('household_id', hh.id)
    .order('created_at');
  if (error) throw error;
  const editable = can.rules();
  let html = `<p>${esc(t('rulesIntro'))}</p>`;
  if (!data.length) html += `<div class="card"><p>${esc(t('noRules'))}</p></div>`;
  for (const kind of ['dont', 'do']) {
    const list = data.filter((r) => r.kind === kind);
    if (!list.length) continue;
    html += `<h2>${esc(t(kind === 'do' ? 'doLabel' : 'dontLabel'))}</h2><div class="card" data-kind="${kind}"><ul class="clean">`;
    for (const r of list) {
      html += ruleRowHtml(r, editable);
    }
    html += '</ul></div>';
  }
  if (editable) {
    if (ruleForm) html += ruleFormHtml();
    else html += `<button class="btn add-rule" onclick="toggleRuleForm(true)">${esc(t('addRule'))}</button>`;
  }
  return html;
}

// The add-rule form. It takes the place of the add button.
function ruleFormHtml() {
  return `<div class="fold${foldEnter('rule')}" data-fold="rule"><div class="card"><h2 style="margin-top:0">${esc(t('addRule'))}</h2>
        <label>&nbsp;</label>
        <select id="rkind"><option value="dont">${esc(t('dontLabel'))}</option><option value="do">${esc(t('doLabel'))}</option></select>
        <label>${esc(t('ruleText'))}</label><input id="rtext">
        <label>${esc(t('ruleTextAr'))}</label><input id="rtext_ar">
        <label>${esc(t('ruleIngredient'))}</label><input id="rkey">
        <button class="btn" onclick="saveRule()">${esc(t('save'))}</button>
        <button class="btn secondary" onclick="toggleRuleForm(false)">${esc(t('cancel'))}</button></div></div>`;
}

// Opens the rule form in place, at once, or folds it closed when off.
function toggleRuleForm(on) {
  if (on) {
    ruleForm = true;
    const opened = openFormNow('rule', () => {
      const btn = document.querySelector('.add-rule');
      return btn ? { els: [btn] } : null;
    }, ruleFormHtml());
    if (!opened) loadTab({ quiet: true });
    return;
  }
  closeFormNow('rule', () => { ruleForm = false; });
}

async function saveRule() {
  const text = document.getElementById('rtext').value.trim();
  if (!text) return setProblem(new Error(t('ruleText')));
  const key = document.getElementById('rkey').value.trim().toLowerCase() || null;
  const { data: row, error } = await sb.from('rules').insert({
    household_id: hh.id,
    kind: document.getElementById('rkind').value,
    text_en: text,
    text_ar: document.getElementById('rtext_ar').value.trim() || null,
    ingredient_key: key,
    created_by: session.user.id,
  }).select(RULE_SELECT).single();
  if (error) return setProblem(error);
  // The rule joins its group at once. A first rule of its kind has no group yet, so the tab reloads for it.
  const list = document.querySelector(`[data-kind="${row.kind}"] > ul.clean`);
  if (list) list.insertAdjacentHTML('beforeend', ruleRowHtml(row, true));
  closeFormNow('rule', () => { ruleForm = false; notice = t('ok'); problem = ''; }, () => loadTab({ quiet: true }));
}

async function removeRule(id) {
  if (!confirm(t('confirmDeleteRule'))) return;
  const { error } = await sb.from('rules').delete().eq('id', id);
  if (error) return setProblem(error);
  await loadTab({ quiet: true });
}
