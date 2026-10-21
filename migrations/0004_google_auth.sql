-- Migration: 0004_google_auth
-- Executar com migration_user (NÃO app_user).
-- O runner aplica SET lock_timeout = '2s' e SET statement_timeout = '60s' antes.
--
-- Login com Google (GIS — ID token), mesmo padrão do cidoa:
--   1. auth_identity  — join-point de provedores: (provider, account id) → usuário.
--   2. "user".password vira nullable — conta criada pelo Google não tem senha.

CREATE TABLE IF NOT EXISTS auth_identity (
    id                  BIGSERIAL   PRIMARY KEY,
    user_id             BIGINT      NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
    provider            TEXT        NOT NULL CHECK (provider IN ('google')),
    provider_account_id TEXT        NOT NULL, -- `sub` do Google (estável; o e-mail pode mudar)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_account_id)
);

-- FK: Postgres não indexa FK automaticamente; sem isso, DELETE em "user" faz seq scan.
CREATE INDEX IF NOT EXISTS idx_auth_identity_user ON auth_identity (user_id);

-- Senha opcional: login por senha compara NULL contra o hash dummy (mesmo 401).
ALTER TABLE "user" ALTER COLUMN password DROP NOT NULL;
