// Profile: who is signed in, their role in the household, and sign out.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

async function screenProfile() {
  const email = session?.user?.email || '';
  return `
    <div class="card">
      <div class="muted">${esc(t('signedInAs'))}</div>
      <div><strong>${esc(email)}</strong></div>
    </div>
    <div class="card">
      <div class="muted">${esc(t('yourRole'))}</div>
      <div><span class="tag">${esc(t('role_' + hh.role))}</span></div>
      <p>${esc(roleNote())}</p>
    </div>
    <button class="btn danger" onclick="signOut()">${esc(t('signOut'))}</button>`;
}
