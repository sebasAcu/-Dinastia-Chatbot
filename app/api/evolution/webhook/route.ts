import { NextRequest, NextResponse } from 'next/server'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || ''
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || ''
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || ''
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

// ── Google Drive folder IDs per category ─────────────────────
// Folders must be shared as "Anyone with the link can view"
const FOLDER_CATALOG: Record<string, string> = {
  seccional:  '1SgeBlE_ufUL4P8fp3UeqNsH5KibLUF52',
  cremallera: '15ycLegO6hrGPlmqDfEq59ZT2wXYsjVNM',
  cadena:     '1XnP5w9RJisQ21I0yeo4mpoiXyNFZO2E8',
  piston:     '1Mz29PYNgzSuCmLMVtS3642PjbT3SNBlC',
  elevador:   '1c-s6yEmms4wpbkmVKPuTdE8IbgpmKlhQ',
}

// List up to 2 video/image file IDs from a public Drive folder
async function getFilesFromFolder(folderId: string): Promise<string[]> {
  if (!GOOGLE_API_KEY) {
    console.error('[Media] GOOGLE_API_KEY env var not set')
    return []
  }
  try {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`)
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,mimeType,name)&orderBy=name&pageSize=10&key=${GOOGLE_API_KEY}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      console.error('[Media] Drive API error:', res.status, await res.text())
      return []
    }
    const data = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const files: { id: string; mimeType: string }[] = data.files || []
    return files
      .filter(f => f.mimeType.startsWith('video/') || f.mimeType.startsWith('image/'))
      .slice(0, 2)
      .map(f => f.id)
  } catch (err) {
    console.error('[Media] Drive API fetch failed:', err)
    return []
  }
}

// ── State-specific prompts ───────────────────────────────────
function getStateInstructions(estado: string, opcionElegida: string | null): string {
  switch (estado) {
    case 'inicio':
      return `
ESTADO ACTUAL: INICIO
Saluda al cliente y muéstrale el menú. Si el cliente ya eligió una opción en este mensaje, incluye la etiqueta de estado correspondiente AL FINAL de tu respuesta.

Menú a mostrar:
Buenos días/tardes, es un placer poder servirle 😊
Soy el asistente virtual de Portones Americanos y Elevadores YIREH
¿En qué le puedo ayudar hoy?
✅ 1. Portón nuevo
✅ 2. Motor para portón existente
✅ 3. Elevador
✅ 4. Reparación o mantenimiento

Etiquetas de transición (NUNCA mostrarlas al cliente):
- Si elige 1 o menciona portón nuevo → [ESTADO: porton_nuevo]
- Si elige 2 o menciona motor → [ESTADO: motor_tipo]
- Si elige 3 o menciona elevador → [ESTADO: elevador_uso] [ENVIAR_MEDIA: ELEVADOR]
- Si elige 4 o menciona reparación o mantenimiento → [ESTADO: reparacion]`

    case 'porton_nuevo':
      return `
ESTADO ACTUAL: PORTÓN NUEVO
El cliente quiere un portón nuevo. Recolecta estos datos en orden:
1. Tipo de portón (seccional americano, cortina enrollable, corredizo, abatible)
2. Ancho del espacio
3. Alto del espacio
4. Zona del país

Cuando el cliente mencione "seccional americano", incluye [ENVIAR_MEDIA: SECCIONAL] en esa respuesta (solo una vez).
Cuando tengas TODOS los datos, resúmelos y di que un asesor contactará pronto. Incluye [ESTADO: finalizado].
NUNCA mostrar etiquetas al cliente.`

    case 'motor_tipo':
      return `
ESTADO ACTUAL: TIPO DE MOTOR
El cliente quiere un motor para portón existente. Pregúntale qué tipo de portón tiene:
- Corredizo (desliza horizontalmente) → Motor de Cremallera
- Seccional americano (abre hacia arriba) → Motor de Cadena
- Abatible (2 hojas hacia afuera) → Motor de Pistón

Cuando el cliente especifique el tipo, incluye AL FINAL (invisible para el cliente):
- Si es corredizo → [ESTADO: motor_datos] [OPCION: corredizo] [ENVIAR_MEDIA: CREMALLERA]
- Si es seccional → [ESTADO: motor_datos] [OPCION: seccional] [ENVIAR_MEDIA: CADENA]
- Si es abatible → [ESTADO: motor_datos] [OPCION: abatible] [ENVIAR_MEDIA: PISTON]`

    case 'motor_datos':
      return `
ESTADO ACTUAL: DATOS DEL MOTOR
El cliente tiene un portón ${opcionElegida || 'existente'}. Recolecta:
1. Ancho del portón
2. Si puede desplazarlo con un solo brazo
3. Zona del país

Cuando tengas TODOS los datos, resúmelos y di que un asesor contactará pronto. Incluye [ESTADO: finalizado].
NUNCA mostrar etiquetas al cliente.`

    case 'elevador_uso':
      return `
ESTADO ACTUAL: USO DEL ELEVADOR
El cliente está interesado en un elevador. Pregúntale el uso:
- Carga
- Residencial
- Requisito Ley 7600 (accesibilidad)

Cuando el cliente especifique el uso, incluye AL FINAL:
- Si es carga → [ESTADO: elevador_datos] [OPCION: carga]
- Si es residencial → [ESTADO: elevador_datos] [OPCION: residencial]
- Si es ley 7600 → [ESTADO: elevador_datos] [OPCION: ley7600]
NUNCA mostrar etiquetas al cliente.`

    case 'elevador_datos': {
      const uso = opcionElegida || 'carga'
      const preguntas = uso === 'carga'
        ? `- Cuántos pisos va a subir\n- Con cuánto peso lo van a cargar\n- Dimensiones de la carga más grande\n- Cuántas veces al día se va a accionar\n- Zona del país`
        : `- Cuántos pisos necesita\n- Dimensiones aproximadas de la plataforma\n- Zona del país`
      return `
ESTADO ACTUAL: DATOS DEL ELEVADOR (${uso.toUpperCase()})
Recolecta los siguientes datos:
${preguntas}

Cuando tengas TODOS los datos, resúmelos y di que un asesor contactará pronto. Incluye [ESTADO: finalizado].
NUNCA mostrar etiquetas al cliente.`
    }

    case 'reparacion':
      return `
ESTADO ACTUAL: REPARACIÓN O MANTENIMIENTO
Recolecta:
1. Tipo de portón o elevador
2. Zona del país

Cuando tengas los datos, resúmelos y di que un asesor contactará pronto. Incluye [ESTADO: finalizado].
NUNCA mostrar etiquetas al cliente.`

    default:
      return ''
  }
}

// ── Supabase helpers ─────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getConvState(chatId: string, clientId: string): Promise<any> {
  const r = await fetch(
    `${SB_URL}/rest/v1/conversation_states?chat_id=eq.${encodeURIComponent(chatId)}&client_id=eq.${clientId}&limit=1`,
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
async function sendMessage(instance: string, jid: string, text: string) {
  await fetch(`${EVOLUTION_URL}/message/sendText/${instance}`, {
    method: 'POST',
    headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: jid, text }),
  })
}

async function sendMedia(instance: string, jid: string, fileId: string) {
  const res = await fetch(`${EVOLUTION_URL}/message/sendMedia/${instance}`, {
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
  if (!res.ok) {
    console.error('[Media] Evolution sendMedia failed:', res.status, fileId, await res.text())
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
    if (!client) {
      const r2 = await fetch(`${SB_URL}/rest/v1/clients?select=${cols}&limit=1`, { headers: SB_HEADERS, cache: 'no-store' })
      if (r2.ok) { const rows = await r2.json(); if (rows?.[0]) client = rows[0] }
    }
    if (!client?.id) return NextResponse.json({ status: 'client_not_found' })

    // Ignore anything that isn't a new message (delivery receipts, read ticks,
    // connection events, etc. — many come with fromMe:true and would wrongly pause the bot)
    if (event !== 'messages.upsert') return NextResponse.json({ status: 'ignored' })

    // ── Human reply → pause conversation ────────────────────
    // Only fires for actual messages.upsert events now, not delivery receipts
    if (fromMe) {
      if (jid) await upsertConvState(jid, client.id, { estado: 'pausado' })
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

      // Don't respond if paused or finished
      if (estado === 'pausado' || estado === 'finalizado') {
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

    // ── Send text ────────────────────────────────────────────
    if (cleanReply) await sendMessage(instance, jid, cleanReply)

    // ── Send media (only once per conversation, max 2 files) ──
    let mediaSent = false
    if (mediaTagMatch && !media_enviada) {
      const categoryKey = mediaTagMatch[1].toLowerCase().trim().split(/\s+/)[0]
      const folderId = FOLDER_CATALOG[categoryKey]
      if (!folderId) {
        console.error('[Media] Unknown category key:', categoryKey)
      } else {
        const fileIds = await getFilesFromFolder(folderId)
        if (fileIds.length > 0) {
          for (const fileId of fileIds) {
            await sendMedia(instance, jid, fileId)
          }
          mediaSent = true
        } else {
          console.error('[Media] No files found in folder:', folderId, 'category:', categoryKey)
        }
      }
    }

    // ── Update conversation state (only when machine is on) ──
    if (useMachine) {
      const stateUpdates: Record<string, unknown> = {}
      if (stateTagMatch) stateUpdates.estado = stateTagMatch[1].toLowerCase()
      if (opcionTagMatch) stateUpdates.opcion_elegida = opcionTagMatch[1].toLowerCase().trim()
      if (mediaSent) stateUpdates.media_enviada = true
      if (messageId) {
        stateUpdates.datos_recolectados = {
          ...(convState?.datos_recolectados || {}),
          last_msg_id: messageId,
        }
      }
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
