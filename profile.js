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
  // The photo is private: the database holds only its path, and a short-lived link is made for showing it.
  // Photos from Google sign-in are full web links and can be shown as they are.
  let avatar = '';
  if (prof.avatar_url && /^https?:\/\//.test(prof.avatar_url)) {
    avatar = prof.avatar_url;
  } else if (prof.avatar_url) {
    const { data: signed } = await sb.storage.from('avatars').createSignedUrl(prof.avatar_url, 3600);
    avatar = signed ? signed.signedUrl : '';
  }

  cache.profileNick = nickname;
  cache.profileAvatar = avatar;
  let profileHtml;
  if (profileForm) {
    profileHtml = profileFormHtml();
  } else {
    profileHtml = profileViewHtml(nickname, email, avatar);
  }

  return `
    <div class="card lang-card">
      <div class="muted">${esc(t('settingsLanguage'))}</div>
      <div class="seg lang-seg" role="group" aria-label="${esc(t('settingsLanguage'))}"><span class="seg-ind" aria-hidden="true"></span>
        <button class="${lang === 'en' ? 'on' : ''}" aria-pressed="${lang === 'en'}" onclick="segTap(this); setLang('en')">English</button>
        <button class="${lang === 'ar' ? 'on' : ''}" aria-pressed="${lang === 'ar'}" onclick="segTap(this); setLang('ar')">عربي</button>
      </div>
    </div>
    ${profileHtml}
    <div class="card">
      <div class="muted">${esc(t('yourRole'))}</div>
      <div><span class="tag">${esc(t('role_' + hh.role))}</span>${owner}</div>
      <div class="setup-options" style="margin-top:10px">${[['helper', 'role_helper'], ['member', 'role_member']].map(([v, k]) =>
        `<button class="${hh.role === v ? 'btn' : 'btn secondary'} small" onclick="changeMyRole('${v}')">${esc(t(k))}</button>`).join('')}</div>
      <p>${esc(t(hh.role === 'helper' ? 'helperNote' : 'memberNote'))}</p>
      ${hh.owner ? `<p class="muted">${esc(t('ownerNote'))}</p>` : ''}
    </div>
    <h2>${esc(t('rules'))}</h2>
    ${rules}
    ${installCard('settings')}
    ${people}
    <button class="btn danger" onclick="signOut()">${esc(t('signOut'))}</button>`;
}

// The profile card: picture, nickname and email, with the edit button.
function profileViewHtml(nickname, email, avatar) {
  const picture = avatar
    ? `<img class="avatar" src="${esc(avatar)}" alt="">`
    : `<span class="avatar avatar-initial" aria-hidden="true">${esc((nickname || email || '?').trim().charAt(0).toUpperCase())}</span>`;
  return `<div class="card profile-view">
      ${picture}
      <div class="profile-text">
        <strong>${esc(nickname || t('noNickname'))}</strong>
        <div class="muted">${esc(email)}</div>
      </div>
      <button class="btn secondary small" onclick="toggleProfileForm(true)">${esc(t('editProfile'))}</button>
    </div>`;
}

// The nickname and picture form. It takes the place of the profile card.
function profileFormHtml() {
  const nickname = cache.profileNick || '';
  return `<div class="fold${foldEnter('profile')}" data-fold="profile"><div class="card">
      <h2 style="margin-top:0">${esc(t('editProfile'))}</h2>
      <label>${esc(t('nickname'))}</label>
      <input id="pnick" value="${esc(nickname)}" maxlength="30" autocomplete="nickname">
      <label>${esc(t('profilePhoto'))}</label>
      <input id="pphoto" type="file" accept="image/*">
      <button class="btn" onclick="saveProfile()">${esc(t('save'))}</button>
      <button class="btn secondary" onclick="toggleProfileForm(false)">${esc(t('cancel'))}</button>
    </div></div>`;
}

// Opens the nickname and picture form in place, at once, or folds it closed when off.
function toggleProfileForm(on) {
  if (on) {
    profileForm = true;
    const opened = openFormNow('profile', () => {
      const card = document.querySelector('.profile-view');
      return card ? { els: [card] } : null;
    }, profileFormHtml());
    if (!opened) loadTab({ quiet: true });
    return;
  }
  closeFormNow('profile', () => { profileForm = false; });
}

// Changes your own role (Cook or Family member). The layout follows it.
async function changeMyRole(role) {
  if (role === hh.role) return;
  const { error } = await sb.rpc('set_my_role', { p_household: hh.id, p_role: role });
  if (error) return setProblem(error);
  hh.role = role;
  viewRole = null;
  problem = '';
  notice = t('roleChanged');
  if (!ROLE_TABS[role].includes(tab) && tab !== 'profile') tab = 'home';
  await loadTab({ quiet: true });
}

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
      update.avatar_url = path;
    } catch (e) {
      return setProblem(e);
    }
  }
  const { error } = await sb.from('profiles').update(update).eq('id', session.user.id);
  if (error) return setProblem(error);
  // The card shows the new nickname at once. A new photo shows after the tab reloads.
  cache.profileNick = update.nickname || '';
  const view = profileViewHtml(cache.profileNick, session?.user?.email || '', cache.profileAvatar || '');
  closeFormNow('profile', () => { profileForm = false; notice = t('ok'); problem = ''; }, () => loadTab({ quiet: true }), view);
}
