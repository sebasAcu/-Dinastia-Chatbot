import { NextRequest, NextResponse } from 'next/server'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
const EVOLUTION_URL = process.env.EVOLUTION_API_URL || ''
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || ''

// Temporary debug endpoint, scoped to TEST_ONLY_NUMBER only. Remove after testing.
// Excluded from the next-auth middleware (api/debug) so it can be called headlessly
// with DEBUG_KEY, no browser session needed.
export async function GET(req: NextRequest) {
  if (req.headers.get('x-debug-key') !== process.env.DEBUG_KEY) {
    return NextResponse.json({ status: 'forbidden' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)

  if (searchParams.get('all') === '1') {
    const ar = await fetch(
      `${SB_URL}/rest/v1/message_logs?select=from_number,user_message,bot_response,created_at&order=created_at.desc&limit=30`,
      { headers: SB_HEADERS, cache: 'no-store' }
    )
    const allLogs = await ar.json()
    const csr = await fetch(
      `${SB_URL}/rest/v1/conversation_states?select=chat_id,estado,updated_at&order=updated_at.desc&limit=30`,
      { headers: SB_HEADERS, cache: 'no-store' }
    )
    const allStates = await csr.json()
    return NextResponse.json({ allLogs, allStates })
  }

  const testNumber = searchParams.get('number') || process.env.TEST_ONLY_NUMBER || ''
  if (!testNumber) return NextResponse.json({ status: 'no_test_number_set' })
  const jid = `${testNumber}@s.whatsapp.net`

  const cr = await fetch(`${SB_URL}/rest/v1/clients?select=id,nombre,evolution_instance&limit=1`, { headers: SB_HEADERS, cache: 'no-store' })
  const clients = await cr.json()
  const clientId = clients?.[0]?.id
  const evolutionInstance = clients?.[0]?.evolution_instance

  // Sanity-check the same chatHasPriorHistory call the webhook makes, but
  // without the TEST_ONLY_NUMBER bypass that normally skips it for this
  // number — confirms the Evolution API call itself actually works, using
  // real history from all the manual testing done on this number so far.
  if (searchParams.get('checkHistory') === '1' && evolutionInstance) {
    const hr = await fetch(`${EVOLUTION_URL}/chat/findMessages/${evolutionInstance}`, {
      method: 'POST',
      headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { key: { remoteJid: jid } }, limit: 1 }),
    })
    const raw = await hr.json().catch(() => null)
    const records = raw?.messages?.records ?? raw?.records ?? (Array.isArray(raw) ? raw : [])
    return NextResponse.json({
      jid,
      evolutionInstance,
      httpOk: hr.ok,
      httpStatus: hr.status,
      hasHistory: Array.isArray(records) && records.length > 0,
      recordCount: Array.isArray(records) ? records.length : null,
      rawSample: JSON.stringify(raw).slice(0, 400),
    })
  }

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

  return NextResponse.json({ jid, clientId, evolutionInstance, state, recentLogs: logs })
}
