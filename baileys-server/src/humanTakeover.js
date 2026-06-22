// Si el dueño responde manualmente, el bot se calla con ese contacto 30 minutos
const SILENCE_MS = 30 * 60 * 1000

// clientId -> Map<contactJid, timestamp>
const silenced = new Map()

export function recordHumanReply(clientId, contactJid) {
  if (!silenced.has(clientId)) silenced.set(clientId, new Map())
  silenced.get(clientId).set(contactJid, Date.now())
}

export function isSilenced(clientId, contactJid) {
  const ts = silenced.get(clientId)?.get(contactJid)
  if (!ts) return false
  if (Date.now() - ts > SILENCE_MS) {
    silenced.get(clientId).delete(contactJid)
    return false
  }
  return true
}
