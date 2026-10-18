// People tab (admin only): members and invitations.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// PEOPLE: admin only
// ---------------------------------------------------------------
async function screenMembers() {
  const [mem, inv] = await Promise.all([
    sb.from('household_members').select('user_id, role, profiles(full_name, email)').eq('household_id', hh.id),
    sb.from('invitations').select('id, email, role').eq('household_id', hh.id).eq('accepted', false),
  ]);
  if (mem.error) throw mem.error;
  if (inv.error) throw inv.error;
  let html = '<h2 style="margin-top:0">' + esc(t('members')) + '</h2><div class="card"><ul class="clean">';
  for (const m of mem.data) {
    const who = m.profiles?.full_name || m.profiles?.email || '';
    const isMe = m.user_id === session.user.id;
    const select = `<select onchange="changeRole('${m.user_id}', this.value)" ${isMe ? 'disabled' : ''}>
      ${['admin', 'member', 'helper'].map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${esc(t('role_' + r))}</option>`).join('')}</select>`;
    html += `<li><div><strong>${esc(who)}</strong></div>${select}</li>`;
  }
  html += '</ul></div>';
  if (inv.data.length) {
    html += `<h3>${esc(t('pending'))}</h3><div class="card"><ul class="clean">`;
    for (const i of inv.data) html += `<li>${esc(i.email)} · ${esc(t('role_' + i.role))}</li>`;
    html += '</ul></div>';
  }
  html += `<div class="card"><h2 style="margin-top:0">${esc(t('inviteTitle'))}</h2>
    <label>${esc(t('inviteEmail'))}</label><input id="iemail" type="email" autocomplete="email">
    <label>${esc(t('inviteRole'))}</label>
    <select id="irole">${['member', 'helper', 'admin'].map((r) => `<option value="${r}">${esc(t('role_' + r))}</option>`).join('')}</select>
    <button class="btn" onclick="sendInvite()">${esc(t('invite'))}</button></div>`;
  return html;
}

async function changeRole(userId, role) {
  const { error } = await sb.from('household_members').update({ role }).eq('household_id', hh.id).eq('user_id', userId);
  if (error) return setProblem(error);
  setNotice(t('ok'));
  await loadTab();
}

async function sendInvite() {
  const email = document.getElementById('iemail').value.trim().toLowerCase();
  const role = document.getElementById('irole').value;
  if (!email) return setProblem(new Error(t('inviteEmail')));
  const { error } = await sb.rpc('invite_member', { p_household: hh.id, p_email: email, p_role: role });
  if (error) return setProblem(error);
  setNotice(t('ok'));
  await loadTab();
}
