import { NextRequest, NextResponse } from 'next/server'

// The batch debounce wait (2s) stacks on top of the Gemini call and media
// sends, so the default function timeout leaves too little margin.
export const maxDuration = 30

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

// Writes the post-AI-reply state only if the row is still NOT pausado/finalizado.
// A human takeover (fromMe handler) or a media-finalize can land on this same row
// while a slow Gemini call is in flight; this WHERE clause is enforced atomically
// by Postgres, so whichever write actually "owns" a silence state can never be
// clobbered by a slower request that started earlier. Returns false when the
// conditional update matched no row, meaning someone else already silenced this chat.
async function finalizeReplyState(chatId: string, clientId: string, data: Record<string, unknown>): Promise<boolean> {
  const r = await fetch(
    `${SB_URL}/rest/v1/conversation_states?chat_id=eq.${encodeURIComponent(chatId)}&client_id=eq.${clientId}&estado=not.in.(pausado,finalizado)`,
    {
      method: 'PATCH',
      headers: { ...SB_HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
    }
  )
  if (!r.ok) {
    console.error('[finalizeReplyState] PATCH failed:', r.status, await r.text().catch(() => ''))
    return true // fail open on infra error — don't silently strand the conversation
  }
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) && rows.length > 0
}

// ── Message batching ─────────────────────────────────────────
// WhatsApp users often fire off 2-3 short messages in a row instead of one.
// Without this, each message triggers its own independent AI call reading the
// same stale context, racing to reply — the customer gets two contradictory
// answers and the conversation state ends up wherever the slower one landed.
// Every incoming message queues its text here; the first one in a burst
// becomes the "leader" (via batch_locks), waits briefly, then drains and
// answers once for everything that piled up meanwhile. Followers just queue
// and exit immediately — the leader picks them up.
const BATCH_WINDOW_MS = 2000
const STALE_LOCK_MS = 15_000

async function insertPendingBatchMessage(chatId: string, clientId: string, text: string): Promise<void> {
  await fetch(`${SB_URL}/rest/v1/pending_batch_messages`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ chat_id: chatId, client_id: clientId, text }),
  })
}

// batch_locks has a (chat_id, client_id) primary key, so the INSERT itself is
// the atomic leader-election: Postgres guarantees only one concurrent insert
// for the same pair can succeed. A stale lock (leader crashed mid-flight) is
// reclaimed after STALE_LOCK_MS so a chat never gets stuck waiting forever.
async function tryAcquireBatchLock(chatId: string, clientId: string): Promise<boolean> {
  const claim = async () => {
    const r = await fetch(`${SB_URL}/rest/v1/batch_locks`, {
      method: 'POST',
      headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ chat_id: chatId, client_id: clientId }),
    })
    return r.status
  }

  const status = await claim()
  if (status === 201) return true
  if (status !== 409) {
    console.error('[tryAcquireBatchLock] Unexpected status:', status)
    return true // fail open rather than deadlock the chat
  }

  const lr = await fetch(
    `${SB_URL}/rest/v1/batch_locks?chat_id=eq.${encodeURIComponent(chatId)}&client_id=eq.${clientId}`,
    { headers: SB_HEADERS, cache: 'no-store' }
  )
  const rows = lr.ok ? await lr.json() : []
  const lockedAt = rows?.[0]?.locked_at ? new Date(rows[0].locked_at).getTime() : 0
  if (!lockedAt || Date.now() - lockedAt < STALE_LOCK_MS) return false

  await fetch(
    `${SB_URL}/rest/v1/batch_locks?chat_id=eq.${encodeURIComponent(chatId)}&client_id=eq.${clientId}`,
    { method: 'DELETE', headers: SB_HEADERS }
  )
  return (await claim()) === 201
}

async function releaseBatchLock(chatId: string, clientId: string): Promise<void> {
  await fetch(
    `${SB_URL}/rest/v1/batch_locks?chat_id=eq.${encodeURIComponent(chatId)}&client_id=eq.${clientId}`,
    { method: 'DELETE', headers: SB_HEADERS }
  )
}

async function drainPendingMessages(chatId: string, clientId: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, BATCH_WINDOW_MS))
  const r = await fetch(
    `${SB_URL}/rest/v1/pending_batch_messages?chat_id=eq.${encodeURIComponent(chatId)}&client_id=eq.${clientId}&order=created_at.asc`,
    { headers: SB_HEADERS, cache: 'no-store' }
  )
  const rows: { id: number; text: string }[] = r.ok ? await r.json() : []
  if (rows.length === 0) return ''
  const ids = rows.map((row) => row.id)
  await fetch(`${SB_URL}/rest/v1/pending_batch_messages?id=in.(${ids.join(',')})`, {
    method: 'DELETE',
    headers: SB_HEADERS,
  })
  return rows.map((row) => row.text).join('\n')
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

async function sendEvolutionMedia(instance: string, jid: string, mediaRef: string): Promise<string | null> {
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
    if (r.ok) {
      console.log(`[sendMedia] OK via direct url`)
      const resData = await r.json().catch(() => null)
      return resData?.key?.id || null
    }
    console.error(`[sendMedia] Direct url failed ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return null
  }

  // Legacy: mediaRef is a Google Drive file ID — try multiple methods
  const driveFileId = mediaRef
  try {
    // Attempt 1: lh3 CDN URL
    const r1 = await fetch(evUrl, {
      method: 'POST', headers: evHeaders,
      body: JSON.stringify({ number: jid, mediatype: 'video', media: `https://lh3.googleusercontent.com/d/${driveFileId}`, mimetype: 'video/mp4', fileName: 'video.mp4' }),
    })
    if (r1.ok) {
      console.log(`[sendMedia] OK via lh3`)
      const resData = await r1.json().catch(() => null)
      return resData?.key?.id || null
    }
    console.error(`[sendMedia] lh3 failed ${r1.status}`)

    // Attempt 2: drive uc URL
    const r2 = await fetch(evUrl, {
      method: 'POST', headers: evHeaders,
      body: JSON.stringify({ number: jid, mediatype: 'video', media: `https://drive.google.com/uc?id=${driveFileId}&export=download`, mimetype: 'video/mp4', fileName: 'video.mp4' }),
    })
    if (r2.ok) {
      console.log(`[sendMedia] OK via uc`)
      const resData = await r2.json().catch(() => null)
      return resData?.key?.id || null
    }
    console.error(`[sendMedia] uc failed ${r2.status} — Drive IDs are blocked. Host videos in Supabase Storage.`)
  } catch (err) {
    console.error('[sendMedia] Exception:', err)
  }
  return null
}

// Bot-sent message ids are remembered per chat so a later fromMe echo of that
// same id can be told apart from a message the owner actually typed by hand.
function mergeBotMsgIds(prevDatos: Record<string, unknown>, newIds: (string | null)[]): string[] {
  const prevIds = Array.isArray(prevDatos.bot_msg_ids) ? (prevDatos.bot_msg_ids as string[]) : []
  return Array.from(new Set([...prevIds, ...newIds.filter((id): id is string => !!id)])).slice(-30)
}

// Chats the bot has never touched (no conversation_states row) can still have
// real WhatsApp history — an old contact, or the owner chatting by hand before
// the bot existed. On failure we fail open (assume no history) so a genuinely
// new lead never gets silently dropped.
async function chatHasPriorHistory(instance: string, jid: string): Promise<boolean> {
  try {
    const r = await fetch(`${EVOLUTION_URL}/chat/findMessages/${instance}`, {
      method: 'POST',
      headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { key: { remoteJid: jid } }, limit: 1 }),
    })
    if (!r.ok) {
      console.error('[chatHasPriorHistory] Failed:', r.status, await r.text().catch(() => ''))
      return false
    }
    const data = await r.json()
    const records = data?.messages?.records ?? data?.records ?? (Array.isArray(data) ? data : [])
    console.log(`[chatHasPriorHistory] jid=${jid} records=${Array.isArray(records) ? records.length : 'n/a'} raw=${JSON.stringify(data).slice(0, 300)}`)
    return Array.isArray(records) && records.length > 0
  } catch (err) {
    console.error('[chatHasPriorHistory] Exception:', err)
    return false
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

    // Test mode: when set, the bot only ever talks to this one number — every
    // other chat is ignored before touching the DB or the AI, no exceptions.
    const TEST_ONLY_NUMBER = process.env.TEST_ONLY_NUMBER || ''
    if (TEST_ONLY_NUMBER && jid.split('@')[0] !== TEST_ONLY_NUMBER) {
      return NextResponse.json({ status: 'test_mode_ignored' })
    }

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

    // fromMe dispara tanto para el eco de los mensajes que el propio bot mandó por
    // Evolution como para un mensaje que el dueño escribió a mano desde su WhatsApp.
    // Si el id coincide con uno que el bot mismo mandó, es el eco: se ignora sin tocar
    // el estado. Si no coincide con ninguno, es una respuesta humana real: se apaga
    // el bot para ese chat para siempre.
    if (fromMe) {
      const existing = await getConvState(jid, client.id)
      const botIds: string[] = Array.isArray(existing?.datos_recolectados?.bot_msg_ids)
        ? existing.datos_recolectados.bot_msg_ids
        : []
      if (messageId && botIds.includes(messageId)) {
        return NextResponse.json({ status: 'bot_echo_ignored' })
      }
      await upsertConvState(jid, client.id, {
        estado: 'pausado',
        datos_recolectados: existing?.datos_recolectados || {},
      })
      return NextResponse.json({ status: 'human_takeover' })
    }

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
        const offhoursMsgId = await sendEvolutionMessage(instance, jid, client.offhours_message)
        const existing = await getConvState(jid, client.id)
        await upsertConvState(jid, client.id, {
          estado: existing?.estado || 'inicio',
          datos_recolectados: {
            ...(existing?.datos_recolectados || {}),
            bot_msg_ids: mergeBotMsgIds(existing?.datos_recolectados || {}, [offhoursMsgId]),
          },
        })
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
    const rawConvState = await getConvState(jid, client.id)

    // claim_message above already seeds a bare conversation_states row for any
    // chat it has never seen, so a null check here would never fire. The real
    // signal for "the bot has never actually replied here" is whether it has
    // ever sent a message to this chat — tracked in bot_msg_ids.
    const botHasRepliedBefore = Array.isArray(rawConvState?.datos_recolectados?.bot_msg_ids)
      && rawConvState.datos_recolectados.bot_msg_ids.length > 0

    // A chat the bot has never actually replied to might still have real
    // WhatsApp history (an old contact, or the owner texting by hand pre-bot).
    // Only send the automated welcome to genuinely fresh contacts. Skipped
    // entirely in test mode — the test number's own history shouldn't block
    // the person actually testing the bot.
    if (!botHasRepliedBefore && !TEST_ONLY_NUMBER) {
      const hasHistory = await chatHasPriorHistory(instance, jid)
      if (hasHistory) {
        await upsertConvState(jid, client.id, {
          estado: 'pausado',
          datos_recolectados: rawConvState?.datos_recolectados || {},
        })
        return NextResponse.json({ status: 'skipped_prior_whatsapp_history' })
      }
    }

    const convState = rawConvState ?? { estado: 'inicio', datos_recolectados: {} }
    let estado: string = convState.estado

    // If user sends a greeting while conversation is active, restart fresh.
    // 'finalizado' y 'pausado' son permanentes — nunca vuelven a 'inicio', ni con un saludo.
    const isGreeting = /^\s*(hola|buenas|buenos|hey|hi|hello|ey|oye|holi|saludos|buen\s*d[ií]a|good\s*(morning|afternoon|evening))\b/i.test(text)
    if (isGreeting && estado !== 'inicio' && estado !== 'finalizado' && estado !== 'pausado') {
      console.log(`[Webhook] Greeting detected, resetting estado ${estado}→inicio`)
      await upsertConvState(jid, client.id, { estado: 'inicio', datos_recolectados: {} })
      estado = 'inicio'
    }

    console.log(`[Webhook] msg="${text.slice(0, 30)}" estado=${estado} jid=${jid} msgId=${messageId}`)

    if (estado === 'pausado' || estado === 'finalizado') {
      console.log(`[Webhook] Skipping — estado=${estado}`)
      return NextResponse.json({ status: `skipped_${estado}` })
    }

    // Any media (audio, image, video, sticker, document): send the final message
    // and permanently deactivate the chat instead of trying to process it.
    if (!text.trim()) {
      const mediaType =
        data?.message?.imageMessage ? '[imagen]' :
        data?.message?.videoMessage ? '[video]' :
        (data?.message?.audioMessage || data?.message?.pttMessage) ? '[audio]' :
        data?.message?.stickerMessage ? '[sticker]' :
        data?.message?.documentMessage ? '[documento]' :
        null
      if (!mediaType) return NextResponse.json({ status: 'empty' })

      const finalMsg = 'Lo más pronto posible nuestro asesor se pondrá en contacto con usted para brindarle la cotización. ¡Que tenga un excelente día! 😊'
      const finalMsgId = await sendEvolutionMessage(instance, jid, finalMsg)
      // Re-read right before writing: a text message from the same customer sent
      // moments earlier may still be batching (see below) and could write its own
      // bot_msg_ids/sent_media right around now — merging onto the stale snapshot
      // captured at the top of this request would silently drop that data.
      // finalizeReplyState also refuses to clobber a pausado/finalizado written
      // concurrently (e.g. a human takeover landing in this same narrow window).
      const freshMediaState = await getConvState(jid, client.id)
      const prevDatosMedia = freshMediaState?.datos_recolectados || {}
      const appliedMedia = await finalizeReplyState(jid, client.id, {
        estado: 'finalizado',
        datos_recolectados: {
          ...prevDatosMedia,
          bot_msg_ids: mergeBotMsgIds(prevDatosMedia, [finalMsgId]),
        },
      })
      if (!appliedMedia) {
        console.log(`[Webhook] Media reply sent but state write skipped — chat already pausado/finalizado`)
      }
      if (client.logs_enabled) {
        await fetch(`${SB_URL}/rest/v1/message_logs`, {
          method: 'POST',
          headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
          body: JSON.stringify({
            client_id: client.id,
            from_number: jid,
            user_message: mediaType,
            bot_response: finalMsg,
            status: 'sent',
          }),
        })
      }
      return NextResponse.json({ status: 'media_finalized' })
    }

    // ── Batch rapid-fire messages from the same customer ─────
    // See helper comments above. Followers exit here; the leader waits, drains
    // everything that arrived, and continues below with the combined text.
    await insertPendingBatchMessage(jid, client.id, text)
    const isBatchLeader = await tryAcquireBatchLock(jid, client.id)
    if (!isBatchLeader) {
      return NextResponse.json({ status: 'queued_for_batch' })
    }
    const combinedText = await drainPendingMessages(jid, client.id)
    await releaseBatchLock(jid, client.id)
    if (!combinedText) return NextResponse.json({ status: 'empty' })
    text = combinedText

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

    // Gemini can take a few seconds. If the owner took over this chat by hand
    // (or it got finalized) while we were waiting, do not send the AI's reply
    // at all — that's exactly the "bot suddenly throws the menu mid human chat" bug.
    const stateAfterAi = await getConvState(jid, client.id)
    if (stateAfterAi?.estado === 'pausado' || stateAfterAi?.estado === 'finalizado') {
      console.log(`[Webhook] Aborting AI reply — estado became ${stateAfterAi.estado} while Gemini was thinking`)
      return NextResponse.json({ status: `aborted_${stateAfterAi.estado}` })
    }

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
    // Based on stateAfterAi (read moments ago, right above) rather than the
    // snapshot from the top of the request — same reasoning as the media path.
    const prevDatos: Record<string, unknown> = stateAfterAi?.datos_recolectados || {}
    const sentMedia: string[] = Array.isArray(prevDatos.sent_media) ? prevDatos.sent_media as string[] : []
    const newMediaIds = mediaIds.filter(id => !sentMedia.includes(id))

    if (newMediaIds.length > 0) console.log(`[Media] Sending ${newMediaIds.length} video(s): ${newMediaIds.join(', ')}`)
    if (mediaIds.length > newMediaIds.length) console.log(`[Media] Skipped ${mediaIds.length - newMediaIds.length} duplicate(s)`)
    const sentMediaMsgIds: (string | null)[] = []
    for (const fileId of newMediaIds) {
      sentMediaMsgIds.push(await sendEvolutionMedia(instance, jid, fileId))
    }

    let botMsgId: string | null = null
    if (cleanReply) botMsgId = await sendEvolutionMessage(instance, jid, cleanReply)

    // ── Update conversation state (no-op if someone silenced this chat while we sent) ──
    const updatedSentMedia = Array.from(new Set(sentMedia.concat(newMediaIds)))

    const applied = await finalizeReplyState(jid, client.id, {
      estado: isFinished ? 'finalizado' : 'en_progreso',
      datos_recolectados: {
        ...prevDatos,
        last_msg_id: messageId,
        sent_media: updatedSentMedia,
        bot_msg_ids: mergeBotMsgIds(prevDatos, [...sentMediaMsgIds, botMsgId]),
      },
    })
    if (!applied) {
      console.log(`[Webhook] Reply was sent but state write skipped — chat got silenced concurrently`)
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
