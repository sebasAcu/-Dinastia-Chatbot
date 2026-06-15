-- ═══════════════════════════════════════════════════════════
--  Dinastia Dashboard — Supabase Schema
--  Ejecuta este archivo en: Supabase > SQL Editor > Run
-- ═══════════════════════════════════════════════════════════

-- Tabla de clientes / chatbots
CREATE TABLE IF NOT EXISTS clients (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Información general
  nombre          TEXT        NOT NULL,
  tipo_negocio    TEXT        DEFAULT '',
  whatsapp_number TEXT        NOT NULL DEFAULT '',

  -- Credenciales API (encriptadas en tránsito vía HTTPS)
  whatsapp_token  TEXT        NOT NULL DEFAULT '',
  phone_number_id TEXT        NOT NULL DEFAULT '' UNIQUE,
  groq_api_key    TEXT        NOT NULL DEFAULT '',

  -- Configuración del chatbot
  system_prompt   TEXT        DEFAULT 'Eres un asistente de atención al cliente útil y amigable. Responde de manera concisa y profesional. Si no sabes algo, dilo honestamente.',

  -- Ajuste: horario de atención
  offhours_enabled  BOOLEAN   DEFAULT FALSE,
  offhours_start    TIME      DEFAULT '09:00:00',
  offhours_end      TIME      DEFAULT '18:00:00',
  offhours_message  TEXT      DEFAULT 'Estamos fuera de horario de atención. Te responderemos el próximo día hábil.',

  -- Ajuste: escalado a humano
  escalate_enabled  BOOLEAN   DEFAULT FALSE,
  escalate_number   TEXT      DEFAULT '',
  escalate_message  TEXT      DEFAULT 'Te vamos a conectar con un agente humano que te ayudará.',

  -- Ajuste: logs
  logs_enabled    BOOLEAN     DEFAULT TRUE
);

-- Tabla de logs de conversaciones
CREATE TABLE IF NOT EXISTS message_logs (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  client_id    UUID        REFERENCES clients(id) ON DELETE CASCADE,
  from_number  TEXT        NOT NULL,
  user_message TEXT        NOT NULL,
  bot_response TEXT        NOT NULL,
  status       TEXT        DEFAULT 'sent'
);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Índices
CREATE INDEX IF NOT EXISTS idx_clients_phone_number_id
  ON clients(phone_number_id);

CREATE INDEX IF NOT EXISTS idx_message_logs_client_id
  ON message_logs(client_id);

CREATE INDEX IF NOT EXISTS idx_message_logs_from_number
  ON message_logs(client_id, from_number, created_at DESC);
