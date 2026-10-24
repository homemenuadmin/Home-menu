// Settings and the Supabase client.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

// ---------------------------------------------------------------
// Settings. The publishable key is safe to include in the web app.
// ---------------------------------------------------------------
const SUPABASE_URL = 'https://kyawromxuqwmpqbfzmvt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_P71m-SXEXPBKl1oym9OogQ_R2SEad5Q';
const APP_URL = 'https://home-menu.homemenucontact.workers.dev/';
// Test sign-in: shows a password box on the sign-in screen for the test account.
// Each test sign-in starts the test account fresh (no household, no setup). Set to false to hide it.
const TEST_LOGIN = true;
const TEST_EMAIL = 'test.owner@example.com';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
