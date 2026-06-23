import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-options'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('clients')
    .select('id, created_at, updated_at, nombre, tipo_negocio, whatsapp_number, whatsapp_token, phone_number_id, groq_api_key, system_prompt, offhours_enabled, offhours_start, offhours_end, offhours_message, escalate_enabled, escalate_number, escalate_message, logs_enabled, wa_status')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch evolution_instance separately via RPC to bypass schema cache
  const { data: full } = await supabase.rpc('list_clients')
  const instanceMap = new Map((full ?? []).map((r: { id: string; evolution_instance: string }) => [r.id, r.evolution_instance]))
  const result = (data ?? []).map((c: Record<string, unknown>) => ({ ...c, evolution_instance: instanceMap.get(c.id as string) ?? '' }))

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { data, error } = await supabase.rpc('create_client_full', { p_data: body })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
