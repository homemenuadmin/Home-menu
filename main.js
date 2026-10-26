// Start the app. Must load last.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------
async function start() {
  applyLang();
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (session) {
    await loadHousehold();
    tab = tab || 'home';
    if (hh) await loadTab(); else render();
  } else {
    render();
  }
  sb.auth.onAuthStateChange(async (event, s) => {
    if (event === 'SIGNED_IN' && s && (!session || session.user.id !== s.user.id)) {
      session = s;
      await loadHousehold();
      if (hh) await loadTab(); else render();
    }
    if (event === 'SIGNED_OUT') { session = null; hh = null; stopLive(); render(); }
  });
}
start();
