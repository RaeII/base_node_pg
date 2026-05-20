-- Setup de usuários e permissões. Rodar UMA VEZ por banco, como superuser/owner.
-- Substituir as senhas antes de executar em produção.
--
-- Princípio: dois usuários distintos
--   - migration_user → executa DDL (CREATE, ALTER, DROP)
--   - app_user       → apenas DML (SELECT, INSERT, UPDATE, DELETE)

-- 1. Criar usuários (idempotente)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_user') THEN
        CREATE USER migration_user WITH PASSWORD 'change_me_migration' CONNECTION LIMIT 3;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE USER app_user WITH PASSWORD 'change_me_app' CONNECTION LIMIT 50;
    END IF;
END $$;

-- 2. Permissões básicas para app_user
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
END $$;
GRANT USAGE   ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_user;
GRANT USAGE, SELECT                   ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- 3. Default privileges com FOR ROLE migration_user (CRÍTICO)
-- Sem o FOR ROLE, novas tabelas criadas pelas migrações NÃO herdam permissões.
ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA public
    GRANT USAGE, SELECT                  ON SEQUENCES TO app_user;

-- 4. migration_user precisa ownership do schema para criar objetos
GRANT ALL ON SCHEMA public TO migration_user;
