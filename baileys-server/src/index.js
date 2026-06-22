import 'dotenv/config'
import express from 'express'
import { startSession, stopSession, getQR, getStatus, initAllSessions } from './sessionManager.js'

const app = express()
app.use(express.json())

// Autenticación simple con secret compartido
app.use((req, res, next) => {
  const auth = req.headers.authorization
  if (auth !== `Bearer ${process.env.BAILEYS_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
})

// Estado de la sesión
app.get('/session/:clientId/status', (req, res) => {
  res.json({ status: getStatus(req.params.clientId) })
})

// QR code como base64 PNG data URL
app.get('/session/:clientId/qr', (req, res) => {
  const qr = getQR(req.params.clientId)
  if (!qr) return res.json({ qr: null })
  res.json({ qr })
})

// Iniciar sesión (genera QR)
app.post('/session/:clientId/connect', async (req, res) => {
  try {
    await startSession(req.params.clientId)
    res.json({ ok: true })
  } catch (err) {
    console.error('Error iniciando sesión:', err)
    res.status(500).json({ error: err.message })
  }
})

// Desconectar sesión
app.delete('/session/:clientId', async (req, res) => {
  try {
    await stopSession(req.params.clientId)
    res.json({ ok: true })
  } catch (err) {
    console.error('Error cerrando sesión:', err)
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, async () => {
  console.log(`Baileys server corriendo en :${PORT}`)
  await initAllSessions()
})
