import { NextRequest, NextResponse } from 'next/server'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || ''
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || ''
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

const REACTIVATE_DAYS = 15

// ── Supabase helpers ─────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getConvState(chatId: string, clientId: string): Promise<any> {
  const r = await fetch(
    `${SB_URL}/rest/v1/conversation_states?chat_id=eq.${encodeURIComponent(chatId)}&client_id=eq.${clientId}&order=updated_at.desc&limit=1`,
    { headers: SB_HEADERS, cache: 'no-store' }
  )
  if (!r.ok) return null
  const rows = await r.json()
  return rows?.[0] ?? null
}

async function upsertConvState(chatId: string, clientId: string, data: Record<string, unknown>) {
  await fetch(`${SB_URL}/rest/v1/conversation_states`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      chat_id: chatId,
      client_id: clientId,
      ...data,
      updated_at: new Date().toISOString(),
    }),
  })
}

// ── Evolution helpers ────────────────────────────────────────
async function sendEvolutionMessage(instance: string, jid: string, text: string): Promise<string | null> {
  try {
    const res = await fetch(`${EVOLUTION_URL}/message/sendText/${instance}`, {
      method: 'POST',
      headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: jid, text }),
    })
    if (!res.ok) { console.error('[sendMessage] Failed:', res.status, await res.text()); return null }
    const resData = await res.json()
    return resData?.key?.id || null
  } catch (err) {
    console.error('[sendMessage] Exception:', err)
    return null
  }
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
    const messageId: string = data?.key?.id || ''

    // ── Find client ──────────────────────────────────────────
    const cols = 'id,nombre,groq_api_key,system_prompt,offhours_enabled,offhours_start,offhours_end,offhours_message,logs_enabled,state_machine_enabled,evolution_instance'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any = null
    const r1 = await fetch(
      `${SB_URL}/rest/v1/clients?select=${cols}&evolution_instance=eq.${encodeURIComponent(instance)}&limit=1`,
      { headers: SB_HEADERS, cache: 'no-store' }
    )
    if (r1.ok) { const rows = await r1.json(); client = rows?.[0] ?? null }
    if (!client?.id) return NextResponse.json({ status: 'client_not_found' })

    // Only process new message events
    if (event !== 'messages.upsert') return NextResponse.json({ status: 'ignored' })

    // ── Human reply → pause conversation ────────────────────
    if (fromMe) {
      if (jid) {
        const state = await getConvState(jid, client.id)
        const botMsgIds: string[] = state?.datos_recolectados?.bot_msg_ids || []
        if (messageId && botMsgIds.includes(messageId)) {
          console.log(`[Webhook] bot echo ignored msgId=${messageId} jid=${jid}`)
          return NextResponse.json({ status: 'bot_echo_ignored' })
        }
        console.log(`[Webhook] fromMe human msg → setting pausado for ${jid}`)
        await upsertConvState(jid, client.id, { estado: 'pausado' })
      }
      return NextResponse.json({ status: 'human_reply' })
    }

    const text: string =
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      ''

    if (!jid) return NextResponse.json({ status: 'empty' })

    const useMachine = client.state_machine_enabled !== false

    // ── Early conversation state check ───────────────────────
    // Must run BEFORE isMedia and off-hours so that silenced conversations
    // (finalizado / pausado within 15 days) never receive any reply.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let convState: any = null
    let estado = 'inicio'

    if (useMachine) {
      convState = await getConvState(jid, client.id)
      if (!convState) {
        convState = { estado: 'inicio', datos_recolectados: {} }
      }

      // Dedup: same messageId already processed
      if (messageId && convState.datos_recolectados?.last_msg_id === messageId) {
        return NextResponse.json({ status: 'duplicate' })
      }

      estado = convState.estado
      console.log(`[Webhook] msg="${text.slice(0, 30)}" jid=${jid} estado=${estado} msgId=${messageId}`)

      if (estado === 'finalizado' || estado === 'pausado') {
        const updatedAt = convState.updated_at ? new Date(convState.updated_at) : null
        const daysAgo = updatedAt ? (Date.now() - updatedAt.getTime()) / 86400000 : Infinity

        if (daysAgo < REACTIVATE_DAYS) {
          // Conversation silenced — ignore ALL message types (text and media)
          console.log(`[Webhook] Silenced ${estado} (${daysAgo.toFixed(1)} days ago) — no reply`)
          return NextResponse.json({ status: `silenced_${estado}` })
        }

        // More than 15 days passed → start fresh
        console.log(`[Webhook] Reactivating after ${daysAgo.toFixed(1)} days (was ${estado})`)
        estado = 'inicio'
        convState = { estado: 'inicio', datos_recolectados: {} }
      }
    }

    // ── Off-hours ────────────────────────────────────────────
    if (client.offhours_enabled) {
      const now = new Date()
      const total = now.getUTCHours() * 60 + now.getUTCMinutes()
      const [sh, sm] = (client.offhours_start || '09:00').split(':').map(Number)
      const [eh, em] = (client.offhours_end || '18:00').split(':').map(Number)
      if (total < sh * 60 + sm || total >= eh * 60 + em) {
        await sendEvolutionMessage(instance, jid, client.offhours_message)
        return NextResponse.json({ status: 'offhours' })
      }
    }

    const MENU_PRINCIPAL =
      'Buenas, es un placer poder servirle 😊\n' +
      'Soy el asistente virtual de Portones Americanos y Elevadores YIREH\n' +
      '¿En qué le puedo ayudar hoy?\n' +
      '1️⃣ Portón nuevo\n' +
      '2️⃣ Motor para portón existente\n' +
      '3️⃣ Elevador\n' +
      '4️⃣ Otros'

    // ── Non-text messages → show menu ────────────────────────
    // Only reached if conversation is active (not silenced above)
    if (!text.trim()) {
      const isMedia = data?.message?.imageMessage ||
        data?.message?.audioMessage ||
        data?.message?.videoMessage ||
        data?.message?.stickerMessage ||
        data?.message?.documentMessage ||
        data?.message?.pttMessage
      if (isMedia) {
        await sendEvolutionMessage(instance, jid, MENU_PRINCIPAL)
        return NextResponse.json({ status: 'non_text_menu' })
      }
      return NextResponse.json({ status: 'empty' })
    }

    // ── Mark messageId before calling Groq (optimistic dedup) ─
    if (useMachine && messageId) {
      await upsertConvState(jid, client.id, {
        estado,
        datos_recolectados: {
          ...(convState.datos_recolectados || {}),
          last_msg_id: messageId,
        },
      })
    }

    // ── System prompt ─────────────────────────────────────────
    const basePrompt = client.system_prompt || 'Eres un asistente útil.'
    const systemPrompt = useMachine
      ? basePrompt + '\n\nCuando envíes el MENSAJE FINAL al cliente, añadí exactamente [CONV_FIN] al final de tu respuesta. El cliente nunca debe ver esa etiqueta.'
      : basePrompt

    // ── Conversation history ─────────────────────────────────
    let history: { user_message: string; bot_response: string }[] = []
    const rh = await fetch(
      `${SB_URL}/rest/v1/message_logs?select=user_message,bot_response&client_id=eq.${client.id}&from_number=eq.${encodeURIComponent(jid)}&order=created_at.desc&limit=8`,
      { headers: SB_HEADERS, cache: 'no-store' }
    )
    if (rh.ok) history = await rh.json()

    const historyMessages = history.reverse().flatMap((log) => [
      { role: 'user', content: log.user_message },
      { role: 'assistant', content: log.bot_response },
    ])

    // ── Call Groq ────────────────────────────────────────────
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.groq_api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          ...historyMessages,
          { role: 'user', content: text },
        ],
        max_tokens: 700,
        temperature: 0.3,
      }),
    })

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => '(no body)')
      console.error(`[Groq] FAILED status=${groqRes.status} body=${errText.slice(0, 300)}`)
      return NextResponse.json({ status: 'groq_error' })
    }
    const groqData = await groqRes.json()
    const rawReply: string = groqData.choices?.[0]?.message?.content || ''

    // ── Parse [CONV_FIN] tag ─────────────────────────────────
    const isFinished = /\[CONV_FIN\]/i.test(rawReply)
    const cleanReply = rawReply
      .replace(/\[CONV_FIN\]/gi, '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim()

    // ── Send message ─────────────────────────────────────────
    let botMsgId: string | null = null
    if (cleanReply) botMsgId = await sendEvolutionMessage(instance, jid, cleanReply)

    // ── Update conversation state ────────────────────────────
    if (useMachine) {
      const prevDatos: Record<string, unknown> = convState?.datos_recolectados || {}
      const prevBotIds: string[] = (prevDatos.bot_msg_ids as string[]) || []
      const newBotIds = botMsgId ? [...prevBotIds.slice(-9), botMsgId] : prevBotIds

      await upsertConvState(jid, client.id, {
        estado: isFinished ? 'finalizado' : 'en_progreso',
        datos_recolectados: { ...prevDatos, last_msg_id: messageId, bot_msg_ids: newBotIds },
      })
    }

    // ── Log ──────────────────────────────────────────────────
    if (client.logs_enabled) {
      await fetch(`${SB_URL}/rest/v1/message_logs`, {
        method: 'POST',
        headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id: client.id,
          from_number: jid,
          user_message: text,
          bot_response: cleanReply,
          status: 'sent',
        }),
      })
    }

    return NextResponse.json({ status: 'ok', estado: isFinished ? 'finalizado' : 'en_progreso' })
  } catch (err) {
    console.error('[Evolution] Error:', err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
