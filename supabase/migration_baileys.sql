-- ═══════════════════════════════════════════════════════════
--  Migración: Integración Baileys (sin API oficial WhatsApp)
--  Ejecuta en: Supabase > SQL Editor > Run
-- ═══════════════════════════════════════════════════════════

-- Estado de conexión WhatsApp
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS wa_status TEXT DEFAULT 'disconnected';

-- Sesión Baileys guardada en DB (no en archivos locales)
-- Así sobrevive reinicios del servidor sin volver a escanear QR
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS baileys_session JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_wa_status
  ON clients(wa_status);
