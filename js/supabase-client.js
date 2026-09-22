// =========================================================
// BEXHR SHARED SUPABASE BROWSER CLIENT
//
// Infrastructure only.
// Creates the existing BexHR browser Supabase client without
// loading landing-page, login, tenant-login, or MFA behaviour.
//
// Authentication and authorization remain owned by Supabase Auth,
// SessionManager, and database RLS.
// =========================================================
(function initialiseBexHrSupabaseClient() {
  const SUPABASE_URL = "https://zoeglonuxkiwnaabzjqo.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_zNz3vsLoaw9ul1UmwEDAMg_YX-MxMG_";

  if (!window.supabase?.createClient) {
    console.error(
      "BexHR Supabase client could not initialise because supabase-js is unavailable.",
    );
    return;
  }

  if (!window.supabaseClient) {
    window.supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
    );
  }

  // Compatibility globals already published by js/app.js.
  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_PUBLISHABLE_KEY;
})();