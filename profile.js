// Settings: your picture and nickname, who is signed in, their role, the household's rules,
// the people in the household (owner only), and sign out.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

let profileForm = false;   // true while the nickname and picture form is open

async function screenProfile() {
  const email = session?.user?.email || '';
  const owner = hh.owner ? ` <span class="tag gold">${esc(t('ownerTag'))}</span>` : '';
  const [profileRes, people, rules] = await Promise.all([
    sb.from('profiles').select('nickname, avatar_url').eq('id', session.user.id).maybeSingle(),
    can.people() ? peopleSection() : '',
    screenRules(),
  ]);
  if (profileRes.error) throw profileRes.error;
  const prof = profileRes.data || {};
  const nickname = prof.nickname || '';
  const avatar = prof.avatar_url || '';

  let profileHtml;
  if (profileForm) {
    profileHtml = `<div class="card">
      <h2 style="margin-top:0">${esc(t('editProfile'))}</h2>
      <label>${esc(t('nickname'))}</label>
      <input id="pnick" value="${esc(nickname)}" maxlength="30" autocomplete="nickname">
      <label>${esc(t('profilePhoto'))}</label>
      <input id="pphoto" type="file" accept="image/*">
      <button class="btn" onclick="saveProfile()">${esc(t('save'))}</button>
      <button class="btn secondary" onclick="toggleProfileForm(false)">${esc(t('cancel'))}</button>
    </div>`;
  } else {
    const picture = avatar
      ? `<img class="avatar" src="${esc(avatar)}" alt="">`
      : `<span class="avatar avatar-initial" aria-hidden="true">${esc((nickname || email || '?').trim().charAt(0).toUpperCase())}</span>`;
    profileHtml = `<div class="card profile-view">
      ${picture}
      <div class="profile-text">
        <strong>${esc(nickname || t('noNickname'))}</strong>
        <div class="muted">${esc(email)}</div>
      </div>
      <button class="btn secondary small" onclick="toggleProfileForm(true)">${esc(t('editProfile'))}</button>
    </div>`;
  }

  return `
    ${profileHtml}
    <div class="card">
      <div class="muted">${esc(t('yourRole'))}</div>
      <div><span class="tag">${esc(t('role_' + hh.role))}</span>${owner}</div>
      <p>${esc(roleNote())}</p>
      ${hh.owner ? `<p class="muted">${esc(t('ownerNote'))}</p>` : ''}
    </div>
    <h2>${esc(t('rules'))}</h2>
    ${rules}
    ${installCard('settings')}
    ${people}
    <button class="btn danger" onclick="signOut()">${esc(t('signOut'))}</button>`;
}

async function toggleProfileForm(on) { profileForm = on; await loadTab(); }

// Makes a square, smaller JPEG of the chosen photo, so uploads stay small.
function squareImage(file, size) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t('photoProblem')))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('photoProblem'))); };
    img.src = url;
  });
}

async function saveProfile() {
  const update = { nickname: document.getElementById('pnick').value.trim() || null };
  const file = document.getElementById('pphoto').files[0];
  if (file) {
    try {
      const blob = await squareImage(file, 256);
      const path = session.user.id + '/avatar.jpg';
      const { error: uploadError } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) return setProblem(uploadError);
      // A changing number on the end makes the browser show the new picture, not an old copy.
      update.avatar_url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
    } catch (e) {
      return setProblem(e);
    }
  }
  const { error } = await sb.from('profiles').update(update).eq('id', session.user.id);
  if (error) return setProblem(error);
  profileForm = false;
  setNotice(t('ok'));
  await loadTab();
}
