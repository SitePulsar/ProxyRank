import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: SupabaseClient<any, "public", any> | null = null;

export function createAdminClient() {
  if (!_admin) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _admin = createClient<any>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }
  return _admin;
}
