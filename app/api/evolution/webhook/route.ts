import { NextRequest, NextResponse } from 'next/server'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || ''
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || ''
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

const humanTakeover = new Map<string, Map<string, number>>()
const SILENCE_MS = 30 * 60 * 1000

// ── Catálogo de media por categoría ─────────────────────────
const MEDIA_CATALOG: Record<string, string[]> = {
  elevador: [
    '11xocVABPS0ZQVuv4rIhDdMB4AXPnnQzE',
    '18QQhUX7crMmc-9SpH81SamuNpvERoENA',
    '1EbFIToBEfvKE-Tdalkv3v-FNdgPWRw04',
    '1GiAgscKijfs3VvdxxZRLEKQla8pK2F8h',
    '1zCKsxvqYRLCJjLRnmyCt9OgN1s1hXc59',
  ],
  piston: [
    '1F08Oi0V5LygKbrKhFg0ZrqgjX6B5BHHL',
    '1F8x2gx9gDQkwAwR1nFubZrtQ1_B15aBF',
    '1hmQKXgSjCQHXoQObPAhCgSNXZ888ffgR',
    '1kxt8OW3IXuAGFoL6aTnKSmx_4yqG9cx_',
  ],
  cadena: [
    '14bOwFq7nQInTcOQfN1aY1nKlmNL_X8IJ',
    '1iqOWkry339qiYQJSTBEUZY8Vk9tVi7Qf',
    '1uSaL68q58lFtgMYmHSjDTrCcPmC-2yJm',
    '1RAx3jZ33aLkoNQK_F6XEVzfsHYneKee3',
    '1vdishauxCRFkB-hmK73MoFb3qhppJghl',
  ],
  cremallera: [
    '13uxFd9SDcPkrM6dWdxD9MbRACeaklFvf',
    '1iZtRhekpw_M1KEIls1k58wZFKumV1BGm',
    '1p76k5wSyi3XAO6KMcKrIBzrdXhCRmT-K',
    '1w2Q9e6QPT2MzhlDgC-ffyDVQ6EJX0hDy',
    '1Y-yt-OTd9XCYsjsItwKs4hXahjz3XJp9',
  ],
  seccional: [
    '1b2fyCPamE4EhTr7ezZ5KlqUxM406Z6kY',
    '1CAbt3K6htZjGlxl4hGGAH9TIVlpaTreG',
    '1fLkxyh0xjg-8fMzCk4vi0jdVeYCf-mMJ',
    '1g5P984rx3Ypq6Puf98itc1KtOTpmJ77X',
    '1sMtE5eCWdZyeGjbQoOcE_ORV2Lm2F_A9',
  ],
}

// Regex para detectar tags de media en cualquier formato que use la IA:
// [SEND_MEDIA:cadena], [ENVIAR_MEDIA: CADENA], [Media: cadena], etc.
const MEDIA_TAG_REGEX = /\[(?:SEND_MEDIA|ENVIAR_MEDIA|Media)\s*:\s*(\w+)\]/gi

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

    // Buscar cliente por evolution_instance via REST directo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any = null
    const cols = 'id,nombre,groq_api_key,system_prompt,offhours_enabled,offhours_start,offhours_end,offhours_message,escalate_enabled,escalate_number,escalate_message,logs_enabled,evolution_instance'
    const r1 = await fetch(`${SB_URL}/rest/v1/clients?select=${cols}&evolution_instance=eq.${encodeURIComponent(instance)}&limit=1`, { headers: SB_HEADERS, cache: 'no-store' })
    if (r1.ok) {
      const rows = await r1.json()
      client = rows?.[0] ?? null
    }

    if (!client) {
      // Fallback: primer cliente disponible
      const r2 = await fetch(`${SB_URL}/rest/v1/clients?select=${cols}&limit=1`, { headers: SB_HEADERS, cache: 'no-store' })
      if (r2.ok) {
        const rows = await r2.json()
        if (rows?.[0]) client = rows[0]
      }
    }

    if (!client || !client.id) {
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
    let history: { user_message: string; bot_response: string }[] = []
    const rh = await fetch(
      `${SB_URL}/rest/v1/message_logs?select=user_message,bot_response&client_id=eq.${client.id}&from_number=eq.${encodeURIComponent(jid)}&order=created_at.desc&limit=8`,
      { headers: SB_HEADERS, cache: 'no-store' }
    )
    if (rh.ok) history = await rh.json()

    const historyMessages = history
      .reverse()
      .flatMap((log) => [
        { role: 'user', content: log.user_message },
        { role: 'assistant', content: log.bot_response },
      ])

    const systemPrompt = client.system_prompt || 'Eres un asistente útil.'

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

    // Detectar tag de media en cualquier formato que use la IA
    MEDIA_TAG_REGEX.lastIndex = 0
    const mediaTagMatch = MEDIA_TAG_REGEX.exec(rawReply)
    MEDIA_TAG_REGEX.lastIndex = 0
    const cleanReply = rawReply.replace(MEDIA_TAG_REGEX, '').trim()

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
      await fetch(`${SB_URL}/rest/v1/message_logs`, {
        method: 'POST',
        headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id: client.id,
          from_number: jid,
          user_message: text,
          bot_response: mediaSent ? `${cleanReply} [Media: ${mediaTagMatch![1]}]` : cleanReply,
          status: 'sent',
        }),
      })
    }

    return NextResponse.json({ status: 'ok', media: mediaSent ? mediaTagMatch![1] : null })
  } catch (err) {
    console.error('[Evolution] Error:', err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
