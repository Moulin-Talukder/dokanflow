-- Creates the DokanFlow database roles, the development database and the
-- integration-test database. Safe to run more than once.
-- Run as a superuser, with psql variables:
--   psql -v owner_password=... -v app_password=... -f bootstrap.sql
--
-- Roles:
--   dokanflow  owns the schema and runs migrations. Never used by the running apps.
--   app_user   is used by the API and worker at runtime. NOSUPERUSER + NOBYPASSRLS
--              means Row Level Security policies always apply to it.

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE dokanflow LOGIN CREATEDB PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dokanflow')
\gexec

SELECT format(
  'CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L',
  :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
\gexec

SELECT 'CREATE DATABASE dokanflow OWNER dokanflow'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'dokanflow')
\gexec

REVOKE ALL ON DATABASE dokanflow FROM PUBLIC;
GRANT CONNECT ON DATABASE dokanflow TO app_user;

-- The separate database used only by integration tests.
\ir test-database.sql

-- Table and sequence privileges for app_user are granted by migrations,
-- so they stay versioned with the schema.
