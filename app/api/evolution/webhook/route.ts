import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || ''
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || ''

const humanTakeover = new Map<string, Map<string, number>>()
const SILENCE_MS = 30 * 60 * 1000

// ── Catálogo de media por categoría ─────────────────────────
const MEDIA_CATALOG: Record<string, string[]> = {
  elevador: [
    '11xocVABPS0ZQVuv4rIhDdMB4AXPnnQzE',
    '18QQhUX7crMmc-9SpH81SamuNpvERoENA',
    '1EbFIToBEfvKE-Tdalkv3v-FNdgPWRw04',
    '1GiAgscKijfs3VvdxxZRLEKQla8pK2F8h',
    '1sKHKCWJ_pdRlnZwRhw_LZVEPom7XkieO',
    '1zCKsxvqYRLCJjLRnmyCt9OgN1s1hXc59',
  ],
  piston: [
    '1EbFI7l4Rq1kpu0Aecvhhjy9hiVP3YOOf',
    '1F08Oi0V5LygKbrKhFg0ZrqgjX6B5BHHL',
    '1F8x2gx9gDQkwAwR1nFubZrtQ1_B15aBF',
    '1hmQKXgSjCQHXoQObPAhCgSNXZ888ffgR',
    '1kxt8OW3IXuAGFoL6aTnKSmx_4yqG9cx_',
    '1pviZn6B0PXJ7izxoQJoUAw5ArZlCLsvy',
  ],
  cadena: [
    '14bOwFq7nQInTcOQfN1aY1nKlmNL_X8IJ',
    '16X0LmyGYS1orwQGW1RYAtW1HBFiOCe88',
    '1iqOWkry339qiYQJSTBEUZY8Vk9tVi7Qf',
    '1iTLjAD9K7BGCB_dHermAPe-OJ1Lv4aoS',
    '1kmFdpIINnqyPSzuKsWmfq8NkyWR11UWL',
    '1qUB8LauekyxTzOHEHjzBcJF6YZPXxjmY',
  ],
  cremallera: [
    '13uxFd9SDcPkrM6dWdxD9MbRACeaklFvf',
    '1D4JD3RWe5FX7C4lgKNCNL7uMB2nVGcJ1',
    '1IXa4p9O6G866C4pNBuCO4c9X4ScEFrYc',
    '1iZtRhekpw_M1KEIls1k58wZFKumV1BGm',
    '1p76k5wSyi3XAO6KMcKrIBzrdXhCRmT-K',
    '1w2Q9e6QPT2MzhlDgC-ffyDVQ6EJX0hDy',
  ],
  seccional: [
    '1b2fyCPamE4EhTr7ezZ5KlqUxM406Z6kY',
    '1CAbt3K6htZjGlxl4hGGAH9TIVlpaTreG',
    '1fLkxyh0xjg-8fMzCk4vi0jdVeYCf-mMJ',
    '1g5P984rx3Ypq6Puf98itc1KtOTpmJ77X',
    '1I1uGijeBXW6zObGNN_XGle-jz3SWS3QX',
    '1ItrKlUF0fVLSztMZIzymFmBY4LUhDqw5',
  ],
}

// Instrucción que se agrega al system prompt para que la IA señale cuándo enviar media
const MEDIA_INSTRUCTIONS = `

INSTRUCCIÓN TÉCNICA (no mencionar al cliente):
Cuando debas enviar imágenes/videos de un producto según tus instrucciones, incluye al FINAL de tu mensaje el tag exacto: [SEND_MEDIA:categoria]
Categorías disponibles:
- [SEND_MEDIA:elevador] → Elevadores
- [SEND_MEDIA:seccional] → Seccionales Americanos
- [SEND_MEDIA:cremallera] → Motor de Cremallera
- [SEND_MEDIA:cadena] → Motor de Cadena
- [SEND_MEDIA:piston] → Motor de Pistón
Incluye el tag solo cuando el cliente haya seleccionado específicamente esa categoría. Úsalo una sola vez por mensaje.`

// ── Helpers ─────────────────────────────────────────────────

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
    headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: jid, text }),
  })
}

async function sendMedia(instance: string, jid: string, fileId: string) {
  await fetch(`${EVOLUTION_URL}/message/sendMedia/${instance}`, {
    method: 'POST',
    headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      number: jid,
      mediatype: 'video',
      mimetype: 'video/mp4',
      media: `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`,
      fileName: 'video.mp4',
      caption: '',
    }),
  })
}

// ── POST handler ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const event = body?.event
    const instance: string = body?.instance
    const data = body?.data

    if (!instance || !data) return NextResponse.json({ status: 'ignored' })

    const fromMe: boolean = data?.key?.fromMe
    const jid: string = data?.key?.remoteJid

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

    if (isSilenced(instance, jid)) {
      return NextResponse.json({ status: 'silenced' })
    }

    // Buscar cliente
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

    // Llamar a Groq con instrucciones de media al final del system prompt
    const systemPrompt = (client.system_prompt || 'Eres un asistente útil.') + MEDIA_INSTRUCTIONS

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${client.groq_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          ...historyMessages,
          { role: 'user', content: text },
        ],
        max_tokens: 700,
        temperature: 0.6,
      }),
    })

    let rawReply = 'Lo siento, no pude procesar su mensaje en este momento.'
    if (groqRes.ok) {
      const groqData = await groqRes.json()
      rawReply = groqData.choices?.[0]?.message?.content || rawReply
    }

    // Detectar tag [SEND_MEDIA:categoria] en la respuesta de la IA
    const mediaTagMatch = rawReply.match(/\[SEND_MEDIA:(\w+)\]/i)
    const cleanReply = rawReply.replace(/\[SEND_MEDIA:\w+\]/gi, '').trim()

    // Enviar texto primero
    await sendMessage(instance, jid, cleanReply)

    // Enviar media si la IA lo indicó
    let mediaSent = false
    if (mediaTagMatch) {
      const categoryKey = mediaTagMatch[1].toLowerCase()
      const fileIds = MEDIA_CATALOG[categoryKey]
      if (fileIds && fileIds.length > 0) {
        for (const fileId of fileIds) {
          await sendMedia(instance, jid, fileId)
        }
        mediaSent = true
      }
    }

    // Guardar log
    if (client.logs_enabled) {
      await supabase.from('message_logs').insert({
        client_id: client.id,
        from_number: jid,
        user_message: text,
        bot_response: mediaSent
          ? `${cleanReply} [Media: ${mediaTagMatch![1]}]`
          : cleanReply,
        status: 'sent',
      })
    }

    return NextResponse.json({ status: 'ok', media: mediaSent ? mediaTagMatch![1] : null })
  } catch (err) {
    console.error('[Evolution] Error:', err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
