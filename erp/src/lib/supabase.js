import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Check erp/.env, then restart `npm run dev` — Vite only reads .env at startup.'
  )
}

export const supabase = createClient(url, key)

/**
 * Call a Postgres function from backend/functions.sql.
 * Every write in this app goes through one of these — the invoice, purchase,
 * payment and adjustment tables have a SELECT policy and no write policy, so
 * .from('invoice').insert(...) is rejected by RLS on purpose.
 */
export async function rpc(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

/** Plain read. RLS scopes every row to the signed-in user automatically. */
export async function select(table, build = (q) => q) {
  const { data, error } = await build(supabase.from(table).select('*'))
  if (error) throw new Error(error.message)
  return data ?? []
}
