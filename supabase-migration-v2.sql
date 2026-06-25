-- ============================================================
-- Real Molinos 3 — Migración v2
-- Soft delete en users + tabla audit_log
-- Correr UNA SOLA VEZ en SQL Editor de Supabase:
-- https://supabase.com/dashboard/project/qxjuztctbpwymmskdyqw/sql/new
-- ============================================================

-- 1. Columnas para soft delete en users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_deleted  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_deleted
  ON public.users(is_deleted)
  WHERE is_deleted = TRUE;

-- 2. Tabla audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type   TEXT        NOT NULL,
  user_id      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  file_path    TEXT,
  result       JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. RLS en audit_log: solo admin puede leer, nadie escribe directamente
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_audit_log"
  ON public.audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Sin política de INSERT/UPDATE/DELETE desde cliente:
-- solo las Edge Functions (service_role) escriben en audit_log.
