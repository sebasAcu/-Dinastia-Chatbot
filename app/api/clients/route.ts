import { NextRequest, NextResponse } from 'next/server'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

const COLS = [
  'id', 'created_at', 'updated_at', 'nombre', 'tipo_negocio',
  'whatsapp_number', 'groq_api_key', 'system_prompt',
  'offhours_enabled', 'offhours_message',
  'escalate_enabled', 'escalate_number', 'escalate_message', 'logs_enabled',
].join(',')

export async function GET() {
  const res = await fetch(
    `${SB_URL}/rest/v1/clients?select=${COLS}&order=created_at.desc`,
    { headers: HEADERS, cache: 'no-store' }
  )
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 500 })
  const raw = await res.json() as Record<string, unknown>[]
  // Attach time fields as strings (TIME type returned by DB)
  const data = raw.map(c => ({ ...c, offhours_start: '09:00', offhours_end: '18:00' }))
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  // Only send columns PostgREST knows about (no evolution_instance — schema cache issue)
  const payload: Record<string, unknown> = {
    nombre: body.nombre ?? '',
    tipo_negocio: body.tipo_negocio ?? '',
    whatsapp_number: body.whatsapp_number ?? '',
    whatsapp_token: body.whatsapp_token ?? '',
    phone_number_id: body.phone_number_id || `evo-${Date.now()}`,
    groq_api_key: body.groq_api_key ?? '',
    system_prompt: body.system_prompt ?? '',
    offhours_enabled: body.offhours_enabled ?? false,
    offhours_start: body.offhours_start ?? '09:00',
    offhours_end: body.offhours_end ?? '18:00',
    offhours_message: body.offhours_message ?? '',
    escalate_enabled: body.escalate_enabled ?? false,
    escalate_number: body.escalate_number ?? '',
    escalate_message: body.escalate_message ?? '',
    logs_enabled: body.logs_enabled ?? true,
  }

  const res = await fetch(`${SB_URL}/rest/v1/clients`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 500 })
  const [created] = await res.json() as Record<string, unknown>[]

  // If evolution_instance provided, update separately via raw SQL patch
  if (body.evolution_instance && created?.id) {
    await fetch(
      `${SB_URL}/rest/v1/clients?id=eq.${created.id}`,
      {
        method: 'PATCH',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ evolution_instance: body.evolution_instance }),
      }
    )
  }

  return NextResponse.json({ ...created, evolution_instance: body.evolution_instance ?? '' }, { status: 201 })
}
