import { NextRequest, NextResponse } from 'next/server'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

// Temporary debug endpoint, scoped to TEST_ONLY_NUMBER only. Remove after testing.
// Excluded from the next-auth middleware (api/debug) so it can be called headlessly
// with DEBUG_KEY, no browser session needed.
export async function GET(req: NextRequest) {
  if (req.headers.get('x-debug-key') !== process.env.DEBUG_KEY) {
    return NextResponse.json({ status: 'forbidden' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)

  const testNumber = process.env.TEST_ONLY_NUMBER || ''
  if (!testNumber) return NextResponse.json({ status: 'no_test_number_set' })
  const jid = `${testNumber}@s.whatsapp.net`

  const cr = await fetch(`${SB_URL}/rest/v1/clients?select=id,nombre&limit=1`, { headers: SB_HEADERS, cache: 'no-store' })
  const clients = await cr.json()
  const clientId = clients?.[0]?.id

  const sr = await fetch(
    `${SB_URL}/rest/v1/conversation_states?chat_id=eq.${encodeURIComponent(jid)}&client_id=eq.${clientId}`,
    { headers: SB_HEADERS, cache: 'no-store' }
  )
  const state = await sr.json()

  const lr = await fetch(
    `${SB_URL}/rest/v1/message_logs?select=user_message,bot_response,created_at&client_id=eq.${clientId}&from_number=eq.${encodeURIComponent(jid)}&order=created_at.desc&limit=10`,
    { headers: SB_HEADERS, cache: 'no-store' }
  )
  const logs = await lr.json()

  if (searchParams.get('reset') === '1') {
    await fetch(
      `${SB_URL}/rest/v1/conversation_states?chat_id=eq.${encodeURIComponent(jid)}&client_id=eq.${clientId}`,
      { method: 'DELETE', headers: SB_HEADERS }
    )
    return NextResponse.json({ status: 'reset_done', jid, clientId })
  }

  return NextResponse.json({ jid, clientId, state, recentLogs: logs })
}
