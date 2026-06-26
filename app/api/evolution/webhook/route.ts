import { NextRequest, NextResponse } from 'next/server'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || ''
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || ''
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || ''
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

// ── Google Drive folder IDs per category (fallback when no client uploads) ──
const FOLDER_CATALOG: Record<string, string> = {
  seccional:  '1SgeBlE_ufUL4P8fp3UeqNsH5KibLUF52',
  cremallera: '15ycLegO6hrGPlmqDfEq59ZT2wXYsjVNM',
  cadena:     '1XnP5w9RJisQ21I0yeo4mpoiXyNFZO2E8',
  piston:     '1Mz29PYNgzSuCmLMVtS3642PjbT3SNBlC',
  elevador:   '1c-s6yEmms4wpbkmVKPuTdE8IbgpmKlhQ',
  // abatible / cortina: no Drive folder — upload via dashboard
}

// Which media categories to send (in order) when entering each state.
// Media is sent BEFORE the text response, matching the prompt flow.
const MEDIA_ON_ENTER: Record<string, string[]> = {
  p_seccional_tipo: ['seccional'],
  p_abatible_tipo:  ['abatible'],       // client uploads only
  p_cortina:        ['cortina'],        // client uploads only
  m_corredizo_tipo: ['cadena', 'cremallera'],
  m_seccional:      ['cadena'],
  m_abatible_tipo:  ['piston'],
  e_carga:          ['elevador'],
  e_residencial:    ['elevador'],
  e_ley7600:        ['elevador'],
}

interface MediaItem { url: string; mimeType: string }

// Client-uploaded media from Supabase (priority over Drive)
async function getClientMedia(clientId: string, categoria: string): Promise<MediaItem[]> {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/client_media_files?client_id=eq.${clientId}&categoria=eq.${encodeURIComponent(categoria)}&select=file_url,mime_type&order=created_at.asc&limit=2`,
      { headers: SB_HEADERS, cache: 'no-store' }
    )
    if (!r.ok) return []
    const rows: { file_url: string; mime_type: string }[] = await r.json()
    return rows.map(r => ({ url: r.file_url, mimeType: r.mime_type || 'video/mp4' }))
  } catch { return [] }
}

// Fallback: list up to 2 files from a public Google Drive folder
async function getDriveMedia(folderId: string): Promise<MediaItem[]> {
  if (!GOOGLE_API_KEY) return []
  try {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`)
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,mimeType)&orderBy=name&pageSize=10&key=${GOOGLE_API_KEY}`,
      { cache: 'no-store' }
    )
    if (!res.ok) { console.error('[Media] Drive API error:', res.status); return [] }
    const data = await res.json()
    const files: { id: string; mimeType: string }[] = data.files || []
    return files
      .filter(f => f.mimeType.startsWith('video/') || f.mimeType.startsWith('image/'))
      .slice(0, 2)
      .map(f => ({
        url: `https://drive.usercontent.google.com/download?id=${f.id}&export=download`,
        mimeType: f.mimeType,
      }))
  } catch (err) {
    console.error('[Media] Drive fetch failed:', err)
    return []
  }
}

// ── State machine instructions ───────────────────────────────
// Each case tells the AI exactly what state it's in, what to say and what
// transition tags to append (never visible to the client).
function getStateInstructions(estado: string, opcionElegida: string | null): string {
  const T = '\nETIQUETAS: Añade solo al final, nunca visibles al cliente. Formato exacto: [ESTADO: xxx] [OPCION: xxx]'

  switch (estado) {

    // ── Menú principal ───────────────────────────────────────
    case 'inicio':
      return `
ESTADO: inicio
Muestra el MENÚ DE BIENVENIDA del prompt EXACTAMENTE. Luego, si el cliente ya eligió en este mismo mensaje:
- 1 o "portón nuevo" → [ESTADO: porton_tipo]
- 2 o "motor" → [ESTADO: motor_tipo]
- 3 o "elevador" → [ESTADO: elevador_uso]
- 4 u "otros" o "reparación" o "mantenimiento" → [ESTADO: otros_tipo]
${T}`

    // ── OPCIÓN 1: Portón nuevo ───────────────────────────────
    case 'porton_tipo':
      return `
ESTADO: porton_tipo
Muestra el sub-menú OPCIÓN 1 del prompt ("Con gusto le ayudamos 😊 ¿Qué tipo de portón tiene? 1️⃣ Corredizo 2️⃣ Seccional americano 3️⃣ Abatible 4️⃣ Cortina Enrollable").
Si el cliente ya respondió en este mensaje:
- 1 o corredizo → [ESTADO: p_corredizo]
- 2 o seccional → [ESTADO: p_seccional_tipo]
- 3 o abatible → [ESTADO: p_abatible_tipo]
- 4 o cortina → [ESTADO: p_cortina]
${T}`

    case 'p_corredizo':
      return `
ESTADO: p_corredizo — Portón corredizo nuevo
Sigue sección 1.1 CORREDIZO del prompt. Pide alto, ancho y zona del país (uno por uno si es necesario).
Cuando tengas los tres datos → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`

    case 'p_seccional_tipo':
      return `
ESTADO: p_seccional_tipo — Portón seccional: tipo de puerta
Sigue sección 1.2 SECCIONAL AMERICANO del prompt: muestra las 3 opciones de puerta.
Cuando el cliente responda 1, 2 o 3 → [ESTADO: p_seccional_datos]
${T}`

    case 'p_seccional_datos':
      return `
ESTADO: p_seccional_datos — Portón seccional: medidas
Responde exactamente: "Perfecto.\n¿En qué medidas lo necesita?\n¿Cuánto debe medir de alto?\n¿Cuánto debe medir de ancho?\n¿En qué zona del país?"
Cuando el cliente dé alto, ancho y zona → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`

    case 'p_abatible_tipo':
      return `
ESTADO: p_abatible_tipo — Portón abatible: tipo de hojas
Sigue sección 1.3 ABATIBLE del prompt: muestra las 2 opciones (1 hoja o 2 hojas).
Cuando el cliente responda 1 o 2 → [ESTADO: p_abatible_datos]
${T}`

    case 'p_abatible_datos':
      return `
ESTADO: p_abatible_datos — Portón abatible: medidas
Responde exactamente: "Perfecto.\n¿En qué medidas lo necesita?\n¿Cuánto debe medir de alto?\n¿Cuánto debe medir de ancho?\n¿En qué zona del país?"
Cuando el cliente dé alto, ancho y zona → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`

    case 'p_cortina':
      return `
ESTADO: p_cortina — Cortina enrollable
Sigue sección 1.4 CORTINA ENROLLABLE del prompt. Pide alto, ancho y zona.
Cuando tengas los tres datos → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`

    // ── OPCIÓN 2: Motor ──────────────────────────────────────
    case 'motor_tipo':
      return `
ESTADO: motor_tipo — Motor para portón existente
Muestra sub-menú OPCIÓN 2: "Con gusto le ayudamos 😊 ¿Qué tipo de portón tiene?\n1️⃣ Corredizo\n2️⃣ Seccional americano\n3️⃣ Abatible"
Si el cliente ya respondió:
- 1 o corredizo → [ESTADO: m_corredizo_tipo]
- 2 o seccional → [ESTADO: m_seccional]
- 3 o abatible → [ESTADO: m_abatible_tipo]
${T}`

    case 'm_corredizo_tipo':
      return `
ESTADO: m_corredizo_tipo — Motor corredizo: tipo de motor
Sigue sección 2.1 CORREDIZO del prompt: muestra las 2 opciones de motor (cadena y cremallera con sus descripciones).
Cuando el cliente responda 1 o cadena → [ESTADO: m_corredizo_datos] [OPCION: cadena]
Cuando el cliente responda 2 o cremallera → [ESTADO: m_corredizo_datos] [OPCION: cremallera]
${T}`

    case 'm_corredizo_datos':
      return `
ESTADO: m_corredizo_datos — Motor corredizo: medidas
Responde exactamente: "Perfecto.\n¿Qué medidas tiene?\n¿Cuánto mide de alto?\n¿Cuánto mide de ancho?\n¿En qué zona del país lo tiene?"
Cuando el cliente dé los tres datos → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`

    case 'm_seccional':
      return `
ESTADO: m_seccional — Motor seccional americano
Sigue sección 2.2 SECCIONAL AMERICANO del prompt.
Responde: "Perfecto.\n¿Qué medidas tiene?\n¿Cuánto mide de alto?\n¿Cuánto mide de ancho?\n¿En qué zona del país lo tiene?"
Cuando el cliente dé los tres datos → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`

    case 'm_abatible_tipo':
      return `
ESTADO: m_abatible_tipo — Motor abatible: tipo de portón
Sigue sección 2.3 ABATIBLE primera parte del prompt: "Para la cotización necesito:\n1️⃣ Portón abatible de una hoja\n2️⃣ Portón abatible de dos hojas"
Cuando el cliente responda 1 o 2 → [ESTADO: m_abatible_motor]
${T}`

    case 'm_abatible_motor':
      return `
ESTADO: m_abatible_motor — Motor abatible: tipo de motor
Sigue la segunda parte de 2.3 ABATIBLE: muestra las 2 opciones de motor (cadena adaptado o pistones con sus descripciones).
Cuando el cliente responda 1 o cadena → [ESTADO: m_abatible_datos] [OPCION: cadena]
Cuando el cliente responda 2 o pistones → [ESTADO: m_abatible_datos] [OPCION: piston]
${T}`

    case 'm_abatible_datos':
      return `
ESTADO: m_abatible_datos — Motor abatible: medidas
Responde exactamente: "Perfecto.\n¿Qué medidas tiene?\n¿Cuánto mide de alto?\n¿Cuánto mide de ancho?\n¿En qué zona del país lo tiene?"
Cuando el cliente dé los tres datos → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`

    // ── OPCIÓN 3: Elevador ───────────────────────────────────
    case 'elevador_uso':
      return `
ESTADO: elevador_uso — Elevador: uso
Muestra el sub-menú OPCIÓN 3: "Con gusto le ayudamos 😊\n¿Para qué uso necesita el elevador?\n1️⃣ Carga\n2️⃣ Residencial\n3️⃣ Requisito Ley 7600"
Si el cliente ya respondió:
- 1 o carga → [ESTADO: e_carga]
- 2 o residencial → [ESTADO: e_residencial]
- 3 o ley7600 o ley o accesibilidad → [ESTADO: e_ley7600]
${T}`

    case 'e_carga':
      return `
ESTADO: e_carga — Elevador de carga
Sigue sección 3.1 CARGA del prompt. Pide: pisos, peso de carga, dimensiones de carga y zona del país.
Cuando el cliente dé todos los datos → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`

    case 'e_residencial':
      return `
ESTADO: e_residencial — Elevador residencial
Sigue sección 3.2 RESIDENCIAL del prompt (incluye la medida estándar 1.10 x 1.40 m). Pide: pisos y zona del país.
Cuando el cliente dé los datos → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`

    case 'e_ley7600':
      return `
ESTADO: e_ley7600 — Elevador Ley 7600
Sigue sección 3.3 LEY 7600 del prompt (texto completo con espacio libre, puerta, motor, rampa). Pide: pisos y zona del país.
Cuando el cliente dé los datos → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`

    // ── OPCIÓN 4: Otros ──────────────────────────────────────
    case 'otros_tipo':
      return `
ESTADO: otros_tipo — Otros servicios
Muestra sub-menú OPCIÓN 4: "Con gusto le ayudamos 😊\n1️⃣ Mantenimiento preventivo\n2️⃣ Mantenimiento correctivo\n3️⃣ Compra de accesorios\n4️⃣ Garantía"
Si el cliente ya respondió:
- 1 o preventivo → [ESTADO: mant_prev_tipo]
- 2 o correctivo → [ESTADO: otros_datos] [OPCION: correctivo]
- 3 o accesorios → [ESTADO: otros_datos] [OPCION: accesorios]
- 4 o garantía → [ESTADO: otros_datos] [OPCION: garantia]
${T}`

    case 'mant_prev_tipo':
      return `
ESTADO: mant_prev_tipo — Mantenimiento preventivo: tipo de equipo
Sigue sección 4.1 MANTENIMIENTO PREVENTIVO primera parte del prompt: muestra el sub-menú de 5 tipos de equipo.
Cuando el cliente elija cualquier opción → [ESTADO: mant_prev_datos]
${T}`

    case 'mant_prev_datos':
      return `
ESTADO: mant_prev_datos — Mantenimiento preventivo: zona
Responde exactamente: "Perfecto.\nPara terminar con la cotización:\n¿En qué zona del país?"
Cuando el cliente dé la zona → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`

    case 'otros_datos': {
      const op = opcionElegida || 'correctivo'
      const instruccion = op === 'accesorios'
        ? 'Sigue sección 4.3 COMPRA DE ACCESORIOS del prompt: pide accesorio, tipo de portón/elevador y zona del país.'
        : op === 'garantia'
          ? 'Sigue sección 4.4 GARANTÍA del prompt: pide nombre completo, teléfono, producto adquirido, descripción del inconveniente y zona del país.'
          : 'Sigue sección 4.2 MANTENIMIENTO CORRECTIVO del prompt: pide tipo de equipo, descripción del problema y zona del país.'
      return `
ESTADO: otros_datos — ${op}
${instruccion}
Cuando el cliente dé todos los datos → responde con el MENSAJE FINAL del prompt e incluye [ESTADO: finalizado]
${T}`
    }

    default:
      return ''
  }
}

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
async function sendMessage(instance: string, jid: string, text: string): Promise<string | null> {
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

async function sendMedia(instance: string, jid: string, mediaUrl: string, mimeType = 'video/mp4'): Promise<boolean> {
  const mediatype = mimeType.startsWith('image/') ? 'image' : 'video'
  const fileName = mediatype === 'image' ? 'imagen.jpg' : 'video.mp4'
  const res = await fetch(`${EVOLUTION_URL}/message/sendMedia/${instance}`, {
    method: 'POST',
    headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: jid, mediatype, mimetype: mimeType, media: mediaUrl, fileName, caption: '' }),
  })
  if (!res.ok) {
    console.error('[Media] Evolution sendMedia failed:', res.status, mediaUrl, await res.text())
    return false
  }
  return true
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
    if (!client) {
      const r2 = await fetch(`${SB_URL}/rest/v1/clients?select=${cols}&limit=1`, { headers: SB_HEADERS, cache: 'no-store' })
      if (r2.ok) { const rows = await r2.json(); if (rows?.[0]) client = rows[0] }
    }
    if (!client?.id) return NextResponse.json({ status: 'client_not_found' })

    // Ignore anything that isn't a new message (delivery receipts, read ticks,
    // connection events, etc. — many come with fromMe:true and would wrongly pause the bot)
    if (event !== 'messages.upsert') return NextResponse.json({ status: 'ignored' })

    // ── Human reply → pause conversation ────────────────────
    // Only fires for actual messages.upsert events now, not delivery receipts.
    // We must distinguish bot-sent message echoes from real human replies.
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

    if (!text.trim() || !jid) return NextResponse.json({ status: 'empty' })

    // ── Off-hours ────────────────────────────────────────────
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

    const useMachine = client.state_machine_enabled !== false

    // ── Conversation state (only when machine is on) ─────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let convState: any = null
    let estado = 'inicio'
    let opcion_elegida: string | null = null
    let media_enviada = false

    if (useMachine) {
      convState = await getConvState(jid, client.id)
      if (!convState) {
        await upsertConvState(jid, client.id, {
          estado: 'inicio',
          opcion_elegida: null,
          media_enviada: false,
          datos_recolectados: {},
        })
        convState = { estado: 'inicio', opcion_elegida: null, media_enviada: false, datos_recolectados: {} }
      }

      // Deduplicate: Evolution API can fire the same event more than once
      if (messageId && convState.datos_recolectados?.last_msg_id === messageId) {
        return NextResponse.json({ status: 'duplicate' })
      }

      estado = convState.estado
      opcion_elegida = convState.opcion_elegida
      media_enviada = convState.media_enviada

      console.log(`[Webhook] msg="${text.slice(0,30)}" jid=${jid} estado=${estado} msgId=${messageId}`)

      // Don't respond if paused or finished
      if (estado === 'pausado' || estado === 'finalizado') {
        console.log(`[Webhook] Skipping — estado=${estado}`)
        return NextResponse.json({ status: `skipped_${estado}` })
      }
    }

    // ── Build system prompt ──────────────────────────────────
    const basePrompt = client.system_prompt || 'Eres un asistente útil.'
    const systemPrompt = useMachine
      ? basePrompt + getStateInstructions(estado, opcion_elegida)
      : basePrompt

    // ── Conversation history ─────────────────────────────────
    let history: { user_message: string; bot_response: string }[] = []
    const rh = await fetch(
      `${SB_URL}/rest/v1/message_logs?select=user_message,bot_response&client_id=eq.${client.id}&from_number=eq.${encodeURIComponent(jid)}&order=created_at.desc&limit=6`,
      { headers: SB_HEADERS, cache: 'no-store' }
    )
    if (rh.ok) history = await rh.json()

    const historyMessages = history.reverse().flatMap((log) => [
      { role: 'user', content: log.user_message },
      { role: 'assistant', content: log.bot_response.replace(/\s*\[Media:\s*[\w\s]+?\]\s*/gi, ' ').trim() },
    ])

    // ── Call Groq ────────────────────────────────────────────
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${client.groq_api_key}`, 'Content-Type': 'application/json' },
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

    let rawReply = 'Buenos días, gracias por comunicarse con Portones Americanos y Elevadores YIREH. En este momento nuestros asesores están atendiendo otras consultas. Le contactaremos a la brevedad posible. 🙏'
    if (groqRes.ok) {
      const groqData = await groqRes.json()
      rawReply = groqData.choices?.[0]?.message?.content || rawReply
    } else {
      const errText = await groqRes.text().catch(() => '(no body)')
      console.error(`[Groq] FAILED status=${groqRes.status} msg="${text.slice(0,30)}" estado=${estado} body=${errText.slice(0,200)}`)
    }

    // ── Parse tags ───────────────────────────────────────────
    const mediaTagMatch = /\[(?:SEND_MEDIA|ENVIAR_MEDIA|Media)\s*:\s*([\w\s]+?)\s*\]/i.exec(rawReply)
    const stateTagMatch = /\[ESTADO:\s*(\w+)\s*\]/i.exec(rawReply)
    const opcionTagMatch = /\[OPCION:\s*([\w\s]+?)\s*\]/i.exec(rawReply)

    const cleanReply = rawReply
      .replace(/\[(?:SEND_MEDIA|ENVIAR_MEDIA|Media)\s*:\s*[\w\s]+?\s*\]/gi, '')
      .replace(/\[ESTADO:\s*\w+\s*\]/gi, '')
      .replace(/\[OPCION:\s*[\w\s]+?\s*\]/gi, '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim()

    // ── Resolve state / option tags ──────────────────────────
    const newEstado = stateTagMatch ? stateTagMatch[1].toLowerCase() : null
    const newOpcion = opcionTagMatch ? opcionTagMatch[1].toLowerCase().trim() : null

    // ── Send media BEFORE text (per prompt flow) ─────────────
    // Media is sent when entering specific states (MEDIA_ON_ENTER).
    // Client-uploaded files take priority; Google Drive is fallback.
    const categoriesToSend = newEstado ? (MEDIA_ON_ENTER[newEstado] || []) : []
    let mediaSent = false
    if (categoriesToSend.length > 0 && !media_enviada) {
      for (const cat of categoriesToSend) {
        let items: MediaItem[] = await getClientMedia(client.id, cat)
        if (items.length === 0) {
          const folderId = FOLDER_CATALOG[cat]
          if (folderId) items = await getDriveMedia(folderId)
        }
        if (items.length > 0) {
          console.log('[Media] Sending category:', cat)
          for (const item of items) {
            const ok = await sendMedia(instance, jid, item.url, item.mimeType)
            if (ok) mediaSent = true
          }
        } else {
          console.log('[Media] No files for category:', cat, '(skipped)')
        }
      }
    } else if (media_enviada && categoriesToSend.length > 0) {
      console.log('[Media] Skipped — media_enviada already true')
    }

    // ── Send text (after media) ───────────────────────────────
    let botMsgId: string | null = null
    if (cleanReply) botMsgId = await sendMessage(instance, jid, cleanReply)

    // ── Update conversation state (only when machine is on) ──
    if (useMachine) {
      const stateUpdates: Record<string, unknown> = {}
      if (newEstado) stateUpdates.estado = newEstado
      if (newOpcion) stateUpdates.opcion_elegida = newOpcion
      if (mediaSent) stateUpdates.media_enviada = true

      const prevDatos: Record<string, unknown> = convState?.datos_recolectados || {}
      // Track bot-sent message IDs so the fromMe echo doesn't pause the conversation
      const prevBotIds: string[] = (prevDatos.bot_msg_ids as string[]) || []
      const newBotIds = botMsgId ? [...prevBotIds.slice(-9), botMsgId] : prevBotIds
      stateUpdates.datos_recolectados = { ...prevDatos, last_msg_id: messageId, bot_msg_ids: newBotIds }

      await upsertConvState(jid, client.id, stateUpdates)
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
          bot_response: mediaSent ? `${cleanReply} [Media: ${mediaTagMatch![1]}]` : cleanReply,
          status: 'sent',
        }),
      })
    }

    return NextResponse.json({ status: 'ok', estado })
  } catch (err) {
    console.error('[Evolution] Error:', err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
