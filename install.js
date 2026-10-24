// Add to home screen: Android, Samsung Internet and Chrome offer an install prompt.
// iPhone (Safari) has no prompt, so it gets written steps instead.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

let deferredInstall = null; // the browser's install offer, when it has made one

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (session && hh) loadTab();
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  if (session && hh) loadTab();
});

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function installDismissed() {
  try { return localStorage.getItem('homemenu-install-dismissed') === '1'; } catch (e) { return false; }
}

// The install card. On the Home tab it can be dismissed; in Settings it always stays while the app is not installed.
function installCard(where) {
  if (isInstalled()) return '';
  if (where === 'home' && (installDismissed() || (!deferredInstall && !isIOS()))) return '';
  const hint = deferredInstall ? t('installText') : isIOS() ? t('installIOS') : t('installMenu');
  const button = deferredInstall
    ? `<button class="btn small" onclick="installApp()">${esc(t('installButton'))}</button>` : '';
  const dismiss = where === 'home'
    ? `<button class="btn secondary small" onclick="dismissInstall()">${esc(t('installDismiss'))}</button>` : '';
  return `<div class="card install-card">
    <strong>${esc(t('installTitle'))}</strong>
    <p class="muted" style="margin:6px 0 10px">${esc(hint)}</p>
    <div class="install-actions">${button}${dismiss}</div>
  </div>`;
}

async function installApp() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const choice = await deferredInstall.userChoice;
  deferredInstall = null;
  if (choice.outcome === 'accepted') return setNotice(t('installed'));
  await loadTab();
}

function dismissInstall() {
  try { localStorage.setItem('homemenu-install-dismissed', '1'); } catch (e) {}
  loadTab();
}
