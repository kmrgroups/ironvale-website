/* =====================================================================
   Balloon Inspector – connection settings.  THE ONLY FILE YOU EDIT.
   ---------------------------------------------------------------------
   1. Supabase → your project → Project Settings → API
   2. Copy "Project URL" into supabaseUrl
   3. Copy the "anon public" key into supabaseAnonKey
      (the anon key is meant to be public – your data is protected by the
       row-level-security rules in supabase/schema.sql. NEVER paste the
       "service_role" key here.)
   Leave both empty to run in offline mode (nothing is saved).
   ===================================================================== */
window.BI_CONFIG = {
  supabaseUrl:     "https://gjwdgpmgcfozyzxckqsu.supabase.co",   // e.g. "https://abcdefghijkl.supabase.co"
  supabaseAnonKey: "sb_publishable_5yiWEiHkEKBq5qsVGaejzQ_udMz12bp",   // e.g. "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

  appName:    "Balloon Inspector",   // shown in the header and browser tab
  engineBase: "balloon/engines/"      // where the DWG/STEP/OCR engine files live
};
