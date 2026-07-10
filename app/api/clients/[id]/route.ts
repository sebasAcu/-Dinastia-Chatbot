import { NextRequest, NextResponse } from 'next/server'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const res = await fetch(
    `${SB_URL}/rest/v1/clients?id=eq.${params.id}&select=id,created_at,updated_at,nombre,tipo_negocio,whatsapp_number,groq_api_key,system_prompt,offhours_enabled,offhours_message,escalate_enabled,escalate_number,escalate_message,logs_enabled,state_machine_enabled&limit=1`,
    { headers: HEADERS, cache: 'no-store' }
  )
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 404 })
  const [data] = await res.json() as Record<string, unknown>[]
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ...data, offhours_start: '09:00', offhours_end: '18:00' })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const body = await req.json()

  const payload: Record<string, unknown> = {
    nombre: body.nombre,
    tipo_negocio: body.tipo_negocio,
    whatsapp_number: body.whatsapp_number,
    whatsapp_token: body.whatsapp_token,
    phone_number_id: body.phone_number_id,
    groq_api_key: body.groq_api_key,
    system_prompt: body.system_prompt,
    offhours_enabled: body.offhours_enabled,
    offhours_start: body.offhours_start,
    offhours_end: body.offhours_end,
    offhours_message: body.offhours_message,
    escalate_enabled: body.escalate_enabled,
    escalate_number: body.escalate_number,
    escalate_message: body.escalate_message,
    logs_enabled: body.logs_enabled,
    state_machine_enabled: body.state_machine_enabled,
  }

  // Update evolution_instance separately if provided
  if (body.evolution_instance !== undefined) {
    await fetch(
      `${SB_URL}/rest/v1/clients?id=eq.${params.id}`,
      {
        method: 'PATCH',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ evolution_instance: body.evolution_instance }),
      }
    )
  }

  const res = await fetch(
    `${SB_URL}/rest/v1/clients?id=eq.${params.id}`,
    {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    }
  )

  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 500 })
  const [data] = await res.json() as Record<string, unknown>[]
  return NextResponse.json({ ...data, evolution_instance: body.evolution_instance ?? '' })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const res = await fetch(
    `${SB_URL}/rest/v1/clients?id=eq.${params.id}`,
    { method: 'DELETE', headers: HEADERS }
  )
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 500 })
  return NextResponse.json({ success: true })
}
