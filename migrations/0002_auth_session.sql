-- Migration: 0002_auth_session
-- Executar com migration_user (NÃO app_user).
-- O runner aplica SET lock_timeout = '2s' e SET statement_timeout = '60s' antes.
--
-- Sessões de login com refresh token rotativo. Uma linha por login (não por
-- rotação): o refresh token é `<id>.<segredo>` e só o SHA-256 do segredo é
-- guardado. Token com id válido e segredo que não confere = reuso → revoga.

CREATE TABLE IF NOT EXISTS auth_session (
    id                  UUID        PRIMARY KEY,
    user_id             BIGINT      NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
    token_hash          TEXT        NOT NULL, -- SHA-256 do segredo atual
    previous_token_hash TEXT,                 -- segredo anterior (tolera refresh concorrente)
    rotated_at          TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ NOT NULL, -- deslizante: renovado a cada rotação
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user_id ON auth_session (user_id);
