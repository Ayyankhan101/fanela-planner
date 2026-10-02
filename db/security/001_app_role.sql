-- 001_app_role.sql — grants for the non-owner application login.
-- Role creation happens in db/migrate-all.sh (password cannot be injected into
-- dollar-quoted SQL by psql). Idempotent: safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fanela_app') THEN
    RAISE EXCEPTION 'role fanela_app missing — run db/migrate-all.sh (it creates the role)';
  END IF;
END
$$;
-- CREATE ROLE defaults are already nosuperuser/nocreaterole/nocreatedb/nobypassrls.
GRANT CONNECT ON DATABASE fanela TO fanela_app;
GRANT USAGE, CREATE ON SCHEMA public TO fanela_app;
