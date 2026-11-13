-- Creates the integration-test database (dokanflow_test) if it is missing.
-- Safe to run more than once. Needs the roles from bootstrap.sql.
-- Integration tests refuse to run against any database whose name does not end
-- in "_test", so they can never touch the development database.

\set ON_ERROR_STOP on

SELECT 'CREATE DATABASE dokanflow_test OWNER dokanflow'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'dokanflow_test')
\gexec

REVOKE ALL ON DATABASE dokanflow_test FROM PUBLIC;
GRANT CONNECT ON DATABASE dokanflow_test TO app_user;
