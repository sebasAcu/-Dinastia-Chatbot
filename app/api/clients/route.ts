import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  // Direct HTTP fetch bypassing PostgREST schema cache entirely
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const cols = [
    'id', 'created_at', 'updated_at', 'nombre', 'tipo_negocio',
    'whatsapp_number', 'groq_api_key', 'system_prompt',
    'offhours_enabled', 'offhours_start', 'offhours_end', 'offhours_message',
    'escalate_enabled', 'escalate_number', 'escalate_message', 'logs_enabled',
  ].join(',')

  const res = await fetch(
    `${url}/rest/v1/clients?select=${cols}&order=created_at.desc`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }
  )

  if (!res.ok) {
    const errText = await res.text()
    console.error('[GET /api/clients] Supabase error:', res.status, errText)
    return NextResponse.json({ error: errText }, { status: 500 })
  }

  const data = await res.json()
  console.log('[GET /api/clients] rows:', data?.length ?? 0)
  return NextResponse.json(Array.isArray(data) ? data : [])
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase.rpc('create_client_full', { p_data: body })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
