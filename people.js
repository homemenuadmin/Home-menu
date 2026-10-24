// People (household owner only): members, their roles, and invite codes. Shown inside Settings.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// PEOPLE: part of Settings, for the household owner only
// ---------------------------------------------------------------
async function peopleSection() {
  const [mem, codes] = await Promise.all([
    sb.from('household_members').select('user_id, role, is_owner, profiles(full_name, email)').eq('household_id', hh.id),
    sb.from('invite_codes').select('code, role, expires_at')
      .eq('household_id', hh.id).eq('revoked', false).is('used_at', null)
      .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
  ]);
  if (mem.error) throw mem.error;
  if (codes.error) throw codes.error;
  let html = '<h2 style="margin-top:0">' + esc(t('members')) + '</h2><div class="card"><ul class="clean">';
  for (const m of mem.data) {
    const who = m.profiles?.full_name || m.profiles?.email || '';
    const owner = m.is_owner ? ` <span class="tag gold">${esc(t('ownerTag'))}</span>` : '';
    const select = `<select onchange="changeRole('${m.user_id}', this.value)">
      ${['member', 'helper'].map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${esc(t('role_' + r))}</option>`).join('')}</select>`;
    html += `<li><div><strong>${esc(who)}</strong>${owner}</div>${select}</li>`;
  }
  html += '</ul></div>';
  html += `<div class="card"><h2 style="margin-top:0">${esc(t('codeTitle'))}</h2>
    <p class="muted">${esc(t('codeNote'))}</p>
    <button class="btn" onclick="createInviteCode()">${esc(t('createCode'))}</button>`;
  if (codes.data.length) {
    html += '<ul class="clean">';
    for (const c of codes.data) {
      const expires = new Date(c.expires_at).toLocaleDateString(t('dateLocale'));
      html += `<li><div class="row"><div><strong class="code">${esc(c.code)}</strong><div class="muted">${esc(t('expires'))} ${esc(expires)}</div></div>
        <button class="btn small danger" onclick="revokeInviteCode('${esc(c.code)}')">${esc(t('revokeCode'))}</button></div></li>`;
    }
    html += '</ul>';
  } else {
    html += `<p class="muted">${esc(t('noCodes'))}</p>`;
  }
  html += '</div>';
  return html;
}

async function changeRole(userId, role) {
  const { error } = await sb.from('household_members').update({ role }).eq('household_id', hh.id).eq('user_id', userId);
  if (error) return setProblem(error);
  setNotice(t('ok'));
  await loadTab();
}

async function createInviteCode() {
  const { data, error } = await sb.rpc('create_invite_code', { p_household: hh.id });
  if (error) return setProblem(error);
  setNotice(t('codeMade') + ' ' + data);
  await loadTab();
}

async function revokeInviteCode(code) {
  if (!confirm(t('confirmRevokeCode'))) return;
  const { error } = await sb.from('invite_codes').update({ revoked: true }).eq('code', code);
  if (error) return setProblem(error);
  setNotice(t('ok'));
  await loadTab();
}
