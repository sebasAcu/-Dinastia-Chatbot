CREATE OR REPLACE FUNCTION list_clients()
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  nombre text,
  tipo_negocio text,
  whatsapp_number text,
  whatsapp_token text,
  phone_number_id text,
  groq_api_key text,
  system_prompt text,
  offhours_enabled boolean,
  offhours_start text,
  offhours_end text,
  offhours_message text,
  escalate_enabled boolean,
  escalate_number text,
  escalate_message text,
  logs_enabled boolean,
  wa_status text,
  evolution_instance text
) AS $$
  SELECT id, created_at, updated_at, nombre, tipo_negocio, whatsapp_number,
    whatsapp_token, phone_number_id, groq_api_key, system_prompt,
    offhours_enabled, offhours_start, offhours_end, offhours_message,
    escalate_enabled, escalate_number, escalate_message, logs_enabled,
    wa_status, evolution_instance
  FROM clients ORDER BY created_at DESC;
$$ LANGUAGE sql SECURITY DEFINER;
