-- Migration: 0001_initial_user
-- Executar com migration_user (NÃO app_user).
-- O runner aplica SET lock_timeout = '2s' e SET statement_timeout = '60s' antes.

CREATE TABLE IF NOT EXISTS "user" (
    id            BIGSERIAL PRIMARY KEY,
    username      VARCHAR(45)  NOT NULL UNIQUE,
    email         VARCHAR(255) UNIQUE,
    password      VARCHAR(255) NOT NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    is_admin      BOOLEAN      NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_is_active ON "user" (is_active) WHERE is_active = TRUE;

-- Atualiza updated_at em UPDATE
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_set_updated_at ON "user";
CREATE TRIGGER trg_user_set_updated_at
    BEFORE UPDATE ON "user"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
