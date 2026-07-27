import { NextResponse } from 'next/server'

// TEMPORARY read-only diagnostic. Delete this file once used.
export async function GET() {
  const EVOLUTION_URL = process.env.EVOLUTION_API_URL || ''
  const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || ''

  let host = ''
  try {
    host = new URL(EVOLUTION_URL).host
  } catch {
    host = '(invalid URL)'
  }

  let pingStatus: number | string = 'n/a'
  let pingBody = ''
  try {
    const r = await fetch(EVOLUTION_URL, { headers: { apikey: EVOLUTION_KEY } })
    pingStatus = r.status
    pingBody = (await r.text()).slice(0, 300)
  } catch (err) {
    pingBody = String(err)
  }

  return NextResponse.json({
    evolution_url_set: !!EVOLUTION_URL,
    evolution_key_set: !!EVOLUTION_KEY,
    evolution_host: host,
    ping_status: pingStatus,
    ping_body_snippet: pingBody,
  })
}
