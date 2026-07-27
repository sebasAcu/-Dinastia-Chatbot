import { NextRequest, NextResponse } from 'next/server'

// TEMPORARY one-time cleanup endpoint. Delete this file once used.
// Resets conversations stuck in 'pausado' by the fromMe-echo bug (2026-07-20..2026-07-27):
// that state didn't exist before that window, so every 'pausado' row today is a bug artifact,
// never a real human takeover.
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.MAINTENANCE_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const r = await fetch(`${SB_URL}/rest/v1/conversation_states?estado=eq.pausado`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ estado: 'en_progreso', updated_at: new Date().toISOString() }),
  })
  const updated = r.ok ? await r.json() : null

  // Also remove the synthetic chat_ids used to diagnose this bug — not real customers.
  const testJids = ['50600000000@s.whatsapp.net', '50611111111@s.whatsapp.net']
  for (const jid of testJids) {
    await fetch(`${SB_URL}/rest/v1/conversation_states?chat_id=eq.${encodeURIComponent(jid)}`, {
      method: 'DELETE', headers: SB_HEADERS,
    })
    await fetch(`${SB_URL}/rest/v1/message_logs?from_number=eq.${encodeURIComponent(jid)}`, {
      method: 'DELETE', headers: SB_HEADERS,
    })
  }

  return NextResponse.json({
    ok: r.ok,
    status: r.status,
    updated_count: Array.isArray(updated) ? updated.length : null,
    updated_chat_ids: Array.isArray(updated) ? updated.map((row: { chat_id: string }) => row.chat_id) : null,
    test_jids_cleaned: testJids,
  })
}
