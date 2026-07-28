import { NextRequest, NextResponse } from 'next/server'

// TEMPORARY single-purpose endpoint. Delete this file once used.
// Scoped by exact client id only — no wildcards, no broad filters.
const CLIENT_ID = '927ca74c-3611-49e2-a826-e776f81f1f4a'
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.MAINTENANCE_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const r = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${CLIENT_ID}&select=id,system_prompt`, {
    headers: SB_HEADERS,
  })
  const rows = r.ok ? await r.json() : null
  return NextResponse.json({ ok: r.ok, status: r.status, rows })
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.MAINTENANCE_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  if (!body?.system_prompt) {
    return NextResponse.json({ error: 'missing system_prompt' }, { status: 400 })
  }
  const r = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${CLIENT_ID}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ system_prompt: body.system_prompt }),
  })
  const updated = r.ok ? await r.json() : null
  return NextResponse.json({ ok: r.ok, status: r.status, updated_ids: updated?.map((c: { id: string }) => c.id) })
}
