-- Migration: 0003_admin
-- Executar com migration_user (NÃO app_user).
-- O runner aplica SET lock_timeout = '2s' e SET statement_timeout = '60s' antes.
--
-- Área administrativa:
-- 1. Elevação admin (step-up): o login em /auth/admin/login abre uma sessão
--    nova com `admin_expires_at` — prazo curto e deslizante, renovado a cada
--    request admin. NULL = sessão comum (sem acesso à área admin).
-- 2. Trilha de auditoria das ações administrativas.

ALTER TABLE auth_session ADD COLUMN IF NOT EXISTS admin_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS audit_log (
    id             BIGSERIAL   PRIMARY KEY,
    actor_id       BIGINT      REFERENCES "user" (id) ON DELETE SET NULL, -- quem fez
    action         VARCHAR(50) NOT NULL,                                  -- ex.: user.update
    target_user_id BIGINT      REFERENCES "user" (id) ON DELETE SET NULL, -- usuário afetado
    detail         JSONB,                                                 -- contexto (nunca senha/token)
    ip             TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Sem índice extra: o painel lista por `id DESC` (usa a PK).
