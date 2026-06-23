import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!

  // Step 1: minimal columns only to test connectivity
  const res = await fetch(
    `${url}/rest/v1/clients?select=id,nombre,tipo_negocio,whatsapp_number,groq_api_key,system_prompt,offhours_enabled,offhours_message,escalate_enabled,escalate_number,escalate_message,logs_enabled,created_at,updated_at&order=created_at.desc`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      cache: 'no-store',
    }
  )

  const body = await res.text()
  console.log('[GET /api/clients] status:', res.status, 'body:', body.slice(0, 300))

  if (!res.ok) {
    return NextResponse.json({ error: body }, { status: 500 })
  }

  let data: unknown[]
  try {
    data = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'parse error', raw: body }, { status: 500 })
  }

  // Attach placeholder time fields expected by the UI
  const clients = (data as Record<string, unknown>[]).map(c => ({
    ...c,
    offhours_start: '09:00',
    offhours_end: '18:00',
  }))

  return NextResponse.json(clients)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase.rpc('create_client_full', { p_data: body })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
