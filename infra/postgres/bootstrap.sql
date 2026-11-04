-- Creates the DokanFlow database roles and database.
-- Run once per cluster as a superuser, with psql variables:
--   psql -v owner_password=... -v app_password=... -f bootstrap.sql
--
-- Roles:
--   dokanflow  owns the schema and runs migrations. Never used by the running apps.
--   app_user   is used by the API and worker at runtime. NOSUPERUSER + NOBYPASSRLS
--              means Row Level Security policies always apply to it.

\set ON_ERROR_STOP on

CREATE ROLE dokanflow LOGIN CREATEDB PASSWORD :'owner_password';
CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_password';

CREATE DATABASE dokanflow OWNER dokanflow;
REVOKE ALL ON DATABASE dokanflow FROM PUBLIC;
GRANT CONNECT ON DATABASE dokanflow TO app_user;

-- Table and sequence privileges for app_user are granted by migrations,
-- so they stay versioned with the schema.
