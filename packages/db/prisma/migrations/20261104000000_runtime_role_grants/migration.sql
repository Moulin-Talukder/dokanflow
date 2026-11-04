-- Privileges for the runtime role.
--
-- Migrations run as the schema owner (dokanflow). The API and worker connect as
-- app_user, which can read and write data but cannot change the schema and is
-- subject to Row Level Security. The app_user role is created by
-- infra/postgres/bootstrap.sql (or by your platform) before migrations run.

GRANT USAGE ON SCHEMA public TO app_user;

-- Tables and sequences created by later migrations (owned by the migration role)
-- become usable by app_user automatically. Only DML is granted: no TRUNCATE,
-- REFERENCES or TRIGGER, and no DDL.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
