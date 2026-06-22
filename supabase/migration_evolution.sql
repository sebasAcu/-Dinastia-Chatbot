-- ═══════════════════════════════════════════════════════════
--  Migración: Integración Evolution API
--  Ejecuta en: Supabase > SQL Editor > Run
-- ═══════════════════════════════════════════════════════════

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS evolution_instance TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_clients_evolution_instance
  ON clients(evolution_instance);
