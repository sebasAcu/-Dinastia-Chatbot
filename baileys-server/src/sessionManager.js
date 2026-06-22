import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { createClient } from '@supabase/supabase-js'
import { toDataURL } from 'qrcode'
import { useSupabaseAuthState } from './supabaseAuthState.js'
import { handleMessage } from './messageHandler.js'
import { recordHumanReply, isSilenced } from './humanTakeover.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// clientId -> { socket, status, qr }
const sessions = new Map()

async function updateStatus(clientId, status) {
  await supabase.from('clients').update({ wa_status: status }).eq('id', clientId)
}

export async function startSession(clientId) {
  if (sessions.has(clientId)) return

  const { state, saveCreds } = await useSupabaseAuthState(clientId, supabase)
  const { version } = await fetchLatestBaileysVersion()

  const session = { status: 'connecting', qr: null, socket: null }
  sessions.set(clientId, session)

  const socket = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: { level: 'silent', child: () => ({ level: 'silent', child: () => ({}) }) },
  })

  session.socket = socket
  socket.ev.on('creds.update', saveCreds)

  socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      try {
        session.qr = await toDataURL(qr)
        session.status = 'qr_pending'
        await updateStatus(clientId, 'qr_pending')
        console.log(`[${clientId}] QR listo para escanear`)
      } catch (err) {
        console.error(`[${clientId}] Error generando QR:`, err)
      }
    }

    if (connection === 'open') {
      session.status = 'connected'
      session.qr = null
      await updateStatus(clientId, 'connected')
      console.log(`[${clientId}] Conectado a WhatsApp`)
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut
      session.status = loggedOut ? 'disconnected' : 'reconnecting'
      await updateStatus(clientId, session.status)
      sessions.delete(clientId)
      console.log(`[${clientId}] Desconectado. Reconectar: ${!loggedOut}`)
      if (!loggedOut) {
        setTimeout(() => startSession(clientId), 5000)
      }
    }
  })

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      // El dueño respondió manualmente → silenciar bot con ese contacto 30 min
      if (msg.key.fromMe) {
        recordHumanReply(clientId, msg.key.remoteJid)
        continue
      }
      // Bot silenciado por toma humana
      if (isSilenced(clientId, msg.key.remoteJid)) {
        console.log(`[${clientId}] Bot silenciado con ${msg.key.remoteJid} (toma humana)`)
        continue
      }
      try {
        await handleMessage(clientId, socket, msg)
      } catch (err) {
        console.error(`[${clientId}] Error manejando mensaje:`, err)
      }
    }
  })
}

export async function stopSession(clientId) {
  const session = sessions.get(clientId)
  if (session?.socket) {
    try {
      await session.socket.logout()
    } catch {
      session.socket.end()
    }
  }
  sessions.delete(clientId)
  // Limpiar sesión guardada en Supabase
  await supabase
    .from('clients')
    .update({ wa_status: 'disconnected', baileys_session: null })
    .eq('id', clientId)
  console.log(`[${clientId}] Sesión cerrada y borrada`)
}

export function getQR(clientId) {
  return sessions.get(clientId)?.qr ?? null
}

export function getStatus(clientId) {
  return sessions.get(clientId)?.status ?? 'disconnected'
}

export async function initAllSessions() {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, wa_status')
    .in('wa_status', ['connected', 'qr_pending', 'reconnecting'])

  for (const client of clients || []) {
    console.log(`[init] Restaurando sesión de ${client.id}`)
    await startSession(client.id)
  }
}
