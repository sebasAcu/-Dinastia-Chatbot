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

async function sendEvolutionMedia(instance: string, jid: string, mediaRef: string): Promise<void> {
  console.log(`[sendMedia] ref="${mediaRef.slice(0, 80)}"`)
  const evUrl = `${EVOLUTION_URL}/message/sendMedia/${instance}`
  const evHeaders = { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' }

  // If mediaRef is a full URL, send it directly to Evolution
  const isUrl = mediaRef.startsWith('http://') || mediaRef.startsWith('https://')
  if (isUrl) {
    const ext = mediaRef.split('.').pop()?.toLowerCase() || ''
    const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)
    const mediatype = isVideo ? 'video' : 'image'
    const mimetype = isVideo ? 'video/mp4' : 'image/jpeg'
    const r = await fetch(evUrl, {
      method: 'POST', headers: evHeaders,
      body: JSON.stringify({ number: jid, mediatype, media: mediaRef, mimetype, fileName: isVideo ? 'video.mp4' : 'image.jpg' }),
    })
    if (r.ok) { console.log(`[sendMedia] OK via direct url`); return }
    console.error(`[sendMedia] Direct url failed ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return
  }

  // Legacy: mediaRef is a Google Drive file ID — try multiple methods
  const driveFileId = mediaRef
  try {
    // Attempt 1: lh3 CDN URL
    const r1 = await fetch(evUrl, {
      method: 'POST', headers: evHeaders,
      body: JSON.stringify({ number: jid, mediatype: 'video', media: `https://lh3.googleusercontent.com/d/${driveFileId}`, mimetype: 'video/mp4', fileName: 'video.mp4' }),
    })
    if (r1.ok) { console.log(`[sendMedia] OK via lh3`); return }
    console.error(`[sendMedia] lh3 failed ${r1.status}`)

    // Attempt 2: drive uc URL
    const r2 = await fetch(evUrl, {
      method: 'POST', headers: evHeaders,
      body: JSON.stringify({ number: jid, mediatype: 'video', media: `https://drive.google.com/uc?id=${driveFileId}&export=download`, mimetype: 'video/mp4', fileName: 'video.mp4' }),
    })
    if (r2.ok) { console.log(`[sendMedia] OK via uc`); return }
    console.error(`[sendMedia] uc failed ${r2.status} — Drive IDs are blocked. Host videos in Supabase Storage.`)
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

    let text: string =
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
    let estado: string = convState.estado

    // If user sends a greeting while conversation is active, restart fresh.
    // 'finalizado' is permanent — never reset back to 'inicio', not even by a greeting.
    const isGreeting = /^\s*(hola|buenas|buenos|hey|hi|hello|ey|oye|holi|saludos|buen\s*d[ií]a|good\s*(morning|afternoon|evening))\b/i.test(text)
    if (isGreeting && estado !== 'inicio' && estado !== 'finalizado') {
      console.log(`[Webhook] Greeting detected, resetting estado ${estado}→inicio`)
      await upsertConvState(jid, client.id, { estado: 'inicio', datos_recolectados: {} })
      estado = 'inicio'
    }

    console.log(`[Webhook] msg="${text.slice(0, 30)}" estado=${estado} jid=${jid} msgId=${messageId}`)

    if (estado === 'pausado' || estado === 'finalizado') {
      console.log(`[Webhook] Skipping — estado=${estado}`)
      return NextResponse.json({ status: `skipped_${estado}` })
    }

    // ── Non-text messages: feed a placeholder so the AI handles it in-flow ──
    // (previously this short-circuited with a hardcoded main menu regardless of
    // conversation state, which derailed mid-flow chats and never got logged)
    if (!text.trim()) {
      const mediaType =
        data?.message?.imageMessage ? 'una imagen' :
        data?.message?.videoMessage ? 'un video' :
        (data?.message?.audioMessage || data?.message?.pttMessage) ? 'un audio' :
        data?.message?.stickerMessage ? 'un sticker' :
        data?.message?.documentMessage ? 'un documento' :
        null
      if (!mediaType) return NextResponse.json({ status: 'empty' })
      text = `[El cliente envió ${mediaType}, cuyo contenido no podés ver. Pedile que responda en texto.]`
    }

    // ── System prompt ─────────────────────────────────────────
    const basePrompt = client.system_prompt || 'Eres un asistente útil.'
    const systemPrompt =
      basePrompt +
      '\n\nCuando envíes el MENSAJE FINAL al cliente, añadí exactamente [CONV_FIN] al final de tu respuesta. El cliente nunca debe ver esa etiqueta.' +
      '\n\nCuando quieras enviar una imagen o video al cliente, incluí exactamente la etiqueta [ENVIAR_MEDIA: URL] en tu respuesta, donde URL es la URL de Supabase Storage indicada en el prompt para ese archivo. Podés incluir varias etiquetas [ENVIAR_MEDIA:] en la misma respuesta. El cliente nunca verá esas etiquetas.'

    // ── Conversation history (skip when starting fresh to avoid confusing the model) ──
    let historyMessages: { role: string; content: string }[] = []
    if (estado !== 'inicio') {
      let history: { user_message: string; bot_response: string }[] = []
      const rh = await fetch(
        `${SB_URL}/rest/v1/message_logs?select=user_message,bot_response&client_id=eq.${client.id}&from_number=eq.${encodeURIComponent(jid)}&order=created_at.desc&limit=6`,
        { headers: SB_HEADERS, cache: 'no-store' }
      )
      if (rh.ok) history = await rh.json()
      historyMessages = history.reverse().flatMap((log) => [
        { role: 'user', content: log.user_message },
        { role: 'assistant', content: log.bot_response },
      ])
    }

    // ── Call AI (Gemini only) ─────────────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY || ''
    const aiMessages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: text },
    ]

    let rawReply = ''

    if (geminiKey) {
      const gr = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${geminiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemini-flash-latest', messages: aiMessages, max_tokens: 1000, temperature: 0.1 }),
      })
      if (gr.ok) {
        const gd = await gr.json()
        rawReply = gd.choices?.[0]?.message?.content || ''
        console.log(`[Gemini] rawReply="${rawReply.slice(0, 200)}"`)
      } else {
        console.error(`[Gemini] FAILED ${gr.status}: ${(await gr.text().catch(() => '')).slice(0, 300)}`)
      }
    }

    if (!rawReply) return NextResponse.json({ status: 'ai_error' })


    // ── Parse [CONV_FIN] and [ENVIAR_MEDIA:] tags ─────────────
    // Detect finish via tag OR via the final message text (in case AI forgets the tag)
    const isFinished = /\[CONV_FIN\]/i.test(rawReply) ||
      /Lo m[aá]s pronto posible nuestro asesor se pondr[aá]/i.test(rawReply)

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

    // ── Send media (skip duplicates already sent this conversation) ──
    const prevDatos: Record<string, unknown> = convState.datos_recolectados || {}
    const sentMedia: string[] = Array.isArray(prevDatos.sent_media) ? prevDatos.sent_media as string[] : []
    const newMediaIds = mediaIds.filter(id => !sentMedia.includes(id))

    if (newMediaIds.length > 0) console.log(`[Media] Sending ${newMediaIds.length} video(s): ${newMediaIds.join(', ')}`)
    if (mediaIds.length > newMediaIds.length) console.log(`[Media] Skipped ${mediaIds.length - newMediaIds.length} duplicate(s)`)
    for (const fileId of newMediaIds) {
      await sendEvolutionMedia(instance, jid, fileId)
    }

    let botMsgId: string | null = null
    if (cleanReply) botMsgId = await sendEvolutionMessage(instance, jid, cleanReply)

    // ── Update conversation state ────────────────────────────
    const updatedSentMedia = Array.from(new Set(sentMedia.concat(newMediaIds)))

    await upsertConvState(jid, client.id, {
      estado: isFinished ? 'finalizado' : 'en_progreso',
      datos_recolectados: { ...prevDatos, last_msg_id: messageId, sent_media: updatedSentMedia },
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
