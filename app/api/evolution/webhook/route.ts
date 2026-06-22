import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || ''
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || ''

// Contactos en modo "toma humana" (dueño respondió manualmente)
// instanceName -> Map<contactJid, timestamp>
const humanTakeover = new Map<string, Map<string, number>>()
const SILENCE_MS = 30 * 60 * 1000

function recordHumanReply(instance: string, jid: string) {
  if (!humanTakeover.has(instance)) humanTakeover.set(instance, new Map())
  humanTakeover.get(instance)!.set(jid, Date.now())
}

function isSilenced(instance: string, jid: string): boolean {
  const ts = humanTakeover.get(instance)?.get(jid)
  if (!ts) return false
  if (Date.now() - ts > SILENCE_MS) {
    humanTakeover.get(instance)!.delete(jid)
    return false
  }
  return true
}

async function sendMessage(instance: string, jid: string, text: string) {
  await fetch(`${EVOLUTION_URL}/message/sendText/${instance}`, {
    method: 'POST',
    headers: {
      apikey: EVOLUTION_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ number: jid, text }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const event = body?.event
    const instance: string = body?.instance
    const data = body?.data

    if (!instance || !data) return NextResponse.json({ status: 'ignored' })

    const fromMe: boolean = data?.key?.fromMe
    const jid: string = data?.key?.remoteJid

    // Dueño respondió manualmente → silenciar bot 30 min con ese contacto
    if (fromMe) {
      recordHumanReply(instance, jid)
      return NextResponse.json({ status: 'human_reply' })
    }

    if (event !== 'messages.upsert') return NextResponse.json({ status: 'ignored' })

    const text: string =
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      ''

    if (!text.trim() || !jid) return NextResponse.json({ status: 'empty' })

    // Bot silenciado por toma humana
    if (isSilenced(instance, jid)) {
      return NextResponse.json({ status: 'silenced' })
    }

    // Buscar cliente por evolution_instance
    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('evolution_instance', instance)
      .single()

    if (error || !client) {
      console.error('[Evolution] Cliente no encontrado para instancia:', instance)
      return NextResponse.json({ status: 'client_not_found' })
    }

    // Horario de atención
    if (client.offhours_enabled) {
      const now = new Date()
      const total = now.getUTCHours() * 60 + now.getUTCMinutes()
      const [sh, sm] = (client.offhours_start || '09:00').split(':').map(Number)
      const [eh, em] = (client.offhours_end || '18:00').split(':').map(Number)
      if (total < sh * 60 + sm || total >= eh * 60 + em) {
        await sendMessage(instance, jid, client.offhours_message)
        return NextResponse.json({ status: 'offhours' })
      }
    }

    // Historial de conversación
    const { data: history } = await supabase
      .from('message_logs')
      .select('user_message, bot_response')
      .eq('client_id', client.id)
      .eq('from_number', jid)
      .order('created_at', { ascending: false })
      .limit(8)

    const historyMessages = (history || [])
      .reverse()
      .flatMap((log: { user_message: string; bot_response: string }) => [
        { role: 'user', content: log.user_message },
        { role: 'assistant', content: log.bot_response },
      ])

    // Llamar a Groq
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
    }

    // Enviar respuesta
    await sendMessage(instance, jid, reply)

    // Guardar log
    if (client.logs_enabled) {
      await supabase.from('message_logs').insert({
        client_id: client.id,
        from_number: jid,
        user_message: text,
        bot_response: reply,
        status: 'sent',
      })
    }

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    console.error('[Evolution] Error:', err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
