import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _client
}

// Proxy para mantener la API `supabase.from(...)` sin cambiar los call sites
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop: string) {
    return getSupabase()[prop as keyof SupabaseClient]
  }
})
