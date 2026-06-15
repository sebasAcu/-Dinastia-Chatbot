import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// ── GET: Meta verifica el webhook ──────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// ── POST: Mensaje entrante de WhatsApp ─────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const value = body?.entry?.[0]?.changes?.[0]?.value

    // Ignorar actualizaciones de estado (delivered, read, etc.)
    if (value?.statuses) return NextResponse.json({ status: 'ok' })

    const message = value?.messages?.[0]
    if (!message || message.type !== 'text') {
      return NextResponse.json({ status: 'ignored' })
    }

    const phoneNumberId: string = value.metadata?.phone_number_id
    const from: string = message.from
    const text: string = message.text?.body?.trim()

    if (!text || !phoneNumberId) return NextResponse.json({ status: 'empty' })

    // Buscar cliente por phone_number_id
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('phone_number_id', phoneNumberId)
      .single()

    if (clientErr || !client) {
      console.error('[Webhook] Cliente no encontrado para phone_number_id:', phoneNumberId)
      return NextResponse.json({ status: 'client_not_found' })
    }

    // Verificar horario de atención
    if (client.offhours_enabled) {
      const now = new Date()
      const totalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
      const [sh, sm] = (client.offhours_start || '09:00').split(':').map(Number)
      const [eh, em] = (client.offhours_end || '18:00').split(':').map(Number)

      if (totalMinutes < sh * 60 + sm || totalMinutes >= eh * 60 + em) {
        await sendWA(phoneNumberId, client.whatsapp_token, from, client.offhours_message)
        return NextResponse.json({ status: 'offhours' })
      }
    }

    // Recuperar historial de esta conversación (últimos 8 mensajes)
    const { data: history } = await supabase
      .from('message_logs')
      .select('user_message, bot_response')
      .eq('client_id', client.id)
      .eq('from_number', from)
      .order('created_at', { ascending: false })
      .limit(8)

    const historyMessages = (history || [])
      .reverse()
      .flatMap((log: { user_message: string; bot_response: string }) => [
        { role: 'user', content: log.user_message },
        { role: 'assistant', content: log.bot_response },
      ])

    // Llamar a Groq (compatible con OpenAI API)
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.groq_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: client.system_prompt || 'Eres un asistente útil.' },
          ...historyMessages,
          { role: 'user', content: text },
        ],
        max_tokens: 600,
        temperature: 0.7,
      }),
    })

    let reply = 'Lo siento, no pude procesar tu mensaje en este momento.'

    if (groqRes.ok) {
      const groqData = await groqRes.json()
      reply = groqData.choices?.[0]?.message?.content || reply
    } else {
      console.error('[Groq] Error:', await groqRes.text())
    }

    // Enviar respuesta por WhatsApp
    await sendWA(phoneNumberId, client.whatsapp_token, from, reply)

    // Guardar log si está habilitado
    if (client.logs_enabled) {
      await supabase.from('message_logs').insert({
        client_id: client.id,
        from_number: from,
        user_message: text,
        bot_response: reply,
        status: 'sent',
      })
    }

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    console.error('[Webhook] Error inesperado:', err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}

async function sendWA(phoneNumberId: string, token: string, to: string, body: string) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body, preview_url: false },
        }),
      }
    )
    if (!res.ok) console.error('[WhatsApp] Send error:', await res.text())
  } catch (err) {
    console.error('[WhatsApp] Exception:', err)
  }
}
