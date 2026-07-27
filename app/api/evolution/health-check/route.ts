import { NextResponse } from 'next/server'

// TEMPORARY read-only diagnostic. Delete this file once used.
export async function GET() {
  const EVOLUTION_URL = process.env.EVOLUTION_API_URL || ''
  const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || ''

  let instancesStatus: number | string = 'n/a'
  let instancesBody = ''
  try {
    const r = await fetch(`${EVOLUTION_URL}/instance/fetchInstances`, {
      headers: { apikey: EVOLUTION_KEY },
    })
    instancesStatus = r.status
    instancesBody = (await r.text()).slice(0, 2000)
  } catch (err) {
    instancesBody = String(err)
  }

  return NextResponse.json({
    instances_status: instancesStatus,
    instances_body: instancesBody,
  })
}
