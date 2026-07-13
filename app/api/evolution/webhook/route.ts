import { NextRequest, NextResponse } from 'next/server'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || ''
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || ''
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

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
    body: JSON.stringify({ chat_id: chatId, client_id: clientId, ...data, updated_at: new Date().toISOString() }),
  })
}

// Atomically claims a message. Returns false if already claimed by a concurrent duplicate webhook.
async function claimMessage(chatId: string, clientId: string, msgId: string): Promise<boolean> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/claim_message`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify({ p_chat_id: chatId, p_client_id: clientId, p_msg_id: msgId }),
  })
  if (!r.ok) {
    console.error('[claimMessage] RPC failed:', r.status, await r.text().catch(() => ''))
    return true // On RPC error, proceed rather than silently drop
  }
  return (await r.json()) === true
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

async function sendEvolutionMedia(instance: string, jid: string, driveFileId: string): Promise<void> {
  // Download from Drive first — Evolution can't follow Drive's redirect chain
  const downloadUrl = `https://drive.usercontent.google.com/download?id=${driveFileId}&export=download&authuser=0&confirm=t`
  console.log(`[sendMedia] Downloading fileId="${driveFileId}"`)
  try {
    const driveRes = await fetch(downloadUrl, { redirect: 'follow' })
    if (!driveRes.ok) {
      console.error(`[sendMedia] Drive download failed: ${driveRes.status}`)
      return
    }
    const contentType = driveRes.headers.get('content-type') || 'video/mp4'
    const isVideo = contentType.startsWith('video/') || contentType === 'application/octet-stream'
    const mediatype = isVideo ? 'video' : 'image'
    const mimetype = isVideo ? 'video/mp4' : 'image/jpeg'

    const buffer = await driveRes.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    console.log(`[sendMedia] ${buffer.byteLength} bytes, type=${contentType}, sending as ${mediatype}`)

    const res = await fetch(`${EVOLUTION_URL}/message/sendMedia/${instance}`, {
      method: 'POST',
      headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: jid, mediatype, media: base64, mimetype, fileName: isVideo ? 'video.mp4' : 'image.jpg' }),
    })
    const body = await res.text()
    if (!res.ok) {
      console.error(`[sendMedia] Evolution failed status=${res.status} body=${body.slice(0, 500)}`)
    } else {
      console.log(`[sendMedia] OK`)
    }
  } catch (err) {
    console.error('[sendMedia] Exception:', err)
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

    // Drop everything except new messages immediately — before any DB calls
    if (event !== 'messages.upsert') return NextResponse.json({ status: 'ignored' })

    const fromMe: boolean = data?.key?.fromMe
    const jid: string = data?.key?.remoteJid
    const messageId: string = data?.key?.id || ''

    if (!jid) return NextResponse.json({ status: 'empty' })

    // ── Find client ──────────────────────────────────────────
    const cols = 'id,nombre,groq_api_key,system_prompt,offhours_enabled,offhours_start,offhours_end,offhours_message,logs_enabled,state_machine_enabled,evolution_instance'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any = null
    const r1 = await fetch(
      `${SB_URL}/rest/v1/clients?select=${cols}&evolution_instance=eq.${encodeURIComponent(instance)}&limit=1`,
      { headers: SB_HEADERS, cache: 'no-store' }
    )
    if (r1.ok) { const rows = await r1.json(); client = rows?.[0] ?? null }
    if (!client) {
      const r2 = await fetch(`${SB_URL}/rest/v1/clients?select=${cols}&limit=1`, { headers: SB_HEADERS, cache: 'no-store' })
      if (r2.ok) { const rows = await r2.json(); if (rows?.[0]) client = rows[0] }
    }
    if (!client?.id) return NextResponse.json({ status: 'client_not_found' })

    // Bot fully silenced when state machine is disabled
    if (client.state_machine_enabled === false) return NextResponse.json({ status: 'disabled' })

    // Ignore all fromMe messages (bot echoes from Evolution)
    if (fromMe) return NextResponse.json({ status: 'bot_echo_ignored' })

    const text: string =
      data?.message?.conversation ||
      data?.message?.extendedTextMessage?.text ||
      ''

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

    // ── Atomic deduplication ─────────────────────────────────
    // DB-level atomic claim: only the first of N concurrent duplicate fires wins.
    // The others return false here and never reach Groq — eliminating wasted tokens.
    if (messageId) {
      const claimed = await claimMessage(jid, client.id, messageId)
      if (!claimed) {
        console.log(`[Webhook] duplicate msgId=${messageId} — dropped`)
        return NextResponse.json({ status: 'duplicate' })
      }
    }

    // ── Conversation state ────────────────────────────────────
    const convState = await getConvState(jid, client.id) ?? { estado: 'inicio', datos_recolectados: {} }
    const estado: string = convState.estado

    console.log(`[Webhook] msg="${text.slice(0, 30)}" estado=${estado} jid=${jid} msgId=${messageId}`)

    if (estado === 'pausado' || estado === 'finalizado') {
      console.log(`[Webhook] Skipping — estado=${estado}`)
      return NextResponse.json({ status: `skipped_${estado}` })
    }

    // ── Non-text messages → show menu ─────────────────────────
    const MENU_PRINCIPAL =
      'Buenas, es un placer poder servirle 😊\n' +
      'Soy el asistente virtual de Portones Americanos y Elevadores YIREH\n' +
      '¿En qué le puedo ayudar hoy?\n' +
      '1️⃣ Portón nuevo\n' +
      '2️⃣ Motor para portón existente\n' +
      '3️⃣ Elevador\n' +
      '4️⃣ Otros'

    if (!text.trim()) {
      const isMedia =
        data?.message?.imageMessage ||
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

    // ── System prompt ─────────────────────────────────────────
    const basePrompt = client.system_prompt || 'Eres un asistente útil.'
    const systemPrompt =
      basePrompt +
      '\n\nCuando envíes el MENSAJE FINAL al cliente, añadí exactamente [CONV_FIN] al final de tu respuesta. El cliente nunca debe ver esa etiqueta.' +
      '\n\nCuando quieras enviar una imagen al cliente, incluí exactamente la etiqueta [ENVIAR_MEDIA: FILE_ID] en tu respuesta, donde FILE_ID es el ID de Google Drive indicado en el prompt para esa imagen. Podés incluir varias etiquetas [ENVIAR_MEDIA:] en la misma respuesta. El cliente nunca verá esas etiquetas.'

    // ── Conversation history (last 6 exchanges) ──────────────
    let history: { user_message: string; bot_response: string }[] = []
    const rh = await fetch(
      `${SB_URL}/rest/v1/message_logs?select=user_message,bot_response&client_id=eq.${client.id}&from_number=eq.${encodeURIComponent(jid)}&order=created_at.desc&limit=6`,
      { headers: SB_HEADERS, cache: 'no-store' }
    )
    if (rh.ok) history = await rh.json()

    const historyMessages = history.reverse().flatMap((log) => [
      { role: 'user', content: log.user_message },
      { role: 'assistant', content: log.bot_response },
    ])

    // ── Call Cerebras (OpenAI-compatible, llama-3.3-70b) ─────
    const cerebrasKey = process.env.CEREBRAS_API_KEY || client.groq_api_key || ''
    const aiRes = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cerebrasKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          ...historyMessages,
          { role: 'user', content: text },
        ],
        max_tokens: 700,
        temperature: 0.3,
      }),
    })

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => '(no body)')
      console.error(`[Cerebras] FAILED status=${aiRes.status} body=${errText.slice(0, 400)}`)
      return NextResponse.json({ status: 'ai_error' })
    }
    const aiData = await aiRes.json()
    const rawReply: string = aiData.choices?.[0]?.message?.content || ''
    console.log(`[Cerebras] rawReply="${rawReply.slice(0, 200)}"`)

    // ── Parse [CONV_FIN] and [ENVIAR_MEDIA:] tags ─────────────
    const isFinished = /\[CONV_FIN\]/i.test(rawReply)

    const mediaIds: string[] = []
    const mediaTagRegex = /\[ENVIAR_MEDIA:\s*([^\]]+)\]/gi
    let mediaMatch
    while ((mediaMatch = mediaTagRegex.exec(rawReply)) !== null) {
      mediaIds.push(mediaMatch[1].trim())
    }

    const cleanReply = rawReply
      .replace(/\[ENVIAR_MEDIA:[^\]]+\]/gi, '')
      .replace(/\[CONV_FIN\]/gi, '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim()

    // ── Send media then text ──────────────────────────────────
    if (mediaIds.length > 0) console.log(`[Media] Sending ${mediaIds.length} image(s): ${mediaIds.join(', ')}`)
    for (const fileId of mediaIds) {
      await sendEvolutionMedia(instance, jid, fileId)
    }
    let botMsgId: string | null = null
    if (cleanReply) botMsgId = await sendEvolutionMessage(instance, jid, cleanReply)

    // ── Update conversation state ────────────────────────────
    const prevDatos: Record<string, unknown> = convState.datos_recolectados || {}

    await upsertConvState(jid, client.id, {
      estado: isFinished ? 'finalizado' : 'en_progreso',
      datos_recolectados: { ...prevDatos, last_msg_id: messageId },
    })

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
