// Settings: who is signed in, their role, the people in the household (owner only), and sign out.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

async function screenProfile() {
  const email = session?.user?.email || '';
  const owner = hh.owner ? ` <span class="tag gold">${esc(t('ownerTag'))}</span>` : '';
  const people = can.people() ? await peopleSection() : '';
  return `
    <div class="card">
      <div class="muted">${esc(t('signedInAs'))}</div>
      <div><strong>${esc(email)}</strong></div>
    </div>
    <div class="card">
      <div class="muted">${esc(t('yourRole'))}</div>
      <div><span class="tag">${esc(t('role_' + hh.role))}</span>${owner}</div>
      <p>${esc(roleNote())}</p>
      ${hh.owner ? `<p class="muted">${esc(t('ownerNote'))}</p>` : ''}
    </div>
    ${installCard('settings')}
    ${people}
    <button class="btn danger" onclick="signOut()">${esc(t('signOut'))}</button>`;
}
