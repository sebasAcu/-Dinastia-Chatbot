import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function handleMessage(clientId, socket, msg) {
  const from = msg.key.remoteJid
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ''

  if (!text.trim()) return

  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single()

  if (error || !client) return

  // Horario de atención
  if (client.offhours_enabled) {
    const now = new Date()
    const totalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
    const [sh, sm] = (client.offhours_start || '09:00').split(':').map(Number)
    const [eh, em] = (client.offhours_end || '18:00').split(':').map(Number)

    if (totalMinutes < sh * 60 + sm || totalMinutes >= eh * 60 + em) {
      await socket.sendMessage(from, { text: client.offhours_message })
      return
    }
  }

  // Historial de conversación (últimos 8)
  const { data: history } = await supabase
    .from('message_logs')
    .select('user_message, bot_response')
    .eq('client_id', clientId)
    .eq('from_number', from)
    .order('created_at', { ascending: false })
    .limit(8)

  const historyMessages = (history || [])
    .reverse()
    .flatMap(log => [
      { role: 'user', content: log.user_message },
      { role: 'assistant', content: log.bot_response },
    ])

  // Llamar a Groq
  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${client.groq_api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: client.system_prompt || 'Eres un asistente útil.' },
        ...historyMessages,
        { role: 'user', content: text },
      ],
      max_tokens: 600,
      temperature: 0.7,
    }),
  })

  let reply = 'Lo siento, no pude procesar tu mensaje en este momento.'

  if (groqRes.ok) {
    const groqData = await groqRes.json()
    reply = groqData.choices?.[0]?.message?.content || reply
  } else {
    console.error('[Groq] Error:', await groqRes.text())
  }

  // Enviar respuesta
  await socket.sendMessage(from, { text: reply })

  // Guardar log
  if (client.logs_enabled) {
    await supabase.from('message_logs').insert({
      client_id: clientId,
      from_number: from,
      user_message: text,
      bot_response: reply,
      status: 'sent',
    })
  }
}
