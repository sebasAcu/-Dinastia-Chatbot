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

  const body = await req.json().catch(() => ({}))

  if (body?.check_chat_id) {
    const chatId = String(body.check_chat_id)
    const r = await fetch(
      `${SB_URL}/rest/v1/conversation_states?chat_id=eq.${encodeURIComponent(chatId)}`,
      { headers: SB_HEADERS }
    )
    const rows = r.ok ? await r.json() : null
    return NextResponse.json({ ok: r.ok, status: r.status, rows })
  }

  if (body?.delete_chat_id) {
    const chatId = String(body.delete_chat_id)
    const r = await fetch(
      `${SB_URL}/rest/v1/conversation_states?chat_id=eq.${encodeURIComponent(chatId)}`,
      { method: 'DELETE', headers: SB_HEADERS }
    )
    return NextResponse.json({ ok: r.ok, status: r.status })
  }

  if (body?.reset_chat_id) {
    const chatId = String(body.reset_chat_id)
    const r = await fetch(
      `${SB_URL}/rest/v1/conversation_states?chat_id=eq.${encodeURIComponent(chatId)}`,
      {
        method: 'PATCH',
        headers: { ...SB_HEADERS, Prefer: 'return=representation' },
        body: JSON.stringify({ estado: 'inicio', datos_recolectados: {} }),
      }
    )
    const updated = r.ok ? await r.json() : null
    return NextResponse.json({ ok: r.ok, status: r.status, updated })
  }

  const enabled = body?.enabled !== false

  const r = await fetch(`${SB_URL}/rest/v1/clients?evolution_instance=eq.portones-yireh`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ state_machine_enabled: enabled }),
  })
  const updated = r.ok ? await r.json() : null

  return NextResponse.json({
    ok: r.ok,
    status: r.status,
    updated,
  })
}
