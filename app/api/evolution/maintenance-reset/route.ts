import { NextRequest, NextResponse } from 'next/server'

// TEMPORARY emergency kill-switch. Delete this file once used.
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.MAINTENANCE_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const r = await fetch(`${SB_URL}/rest/v1/clients?evolution_instance=eq.portones-yireh`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ state_machine_enabled: false }),
  })
  const updated = r.ok ? await r.json() : null

  return NextResponse.json({
    ok: r.ok,
    status: r.status,
    updated,
  })
}
