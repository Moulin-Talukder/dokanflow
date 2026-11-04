#!/bin/sh
# Runs once, the first time the Postgres container initializes its data directory.
set -eu

psql --username "$POSTGRES_USER" --dbname postgres \
  -v owner_password="$DOKANFLOW_OWNER_PASSWORD" \
  -v app_password="$DOKANFLOW_APP_PASSWORD" \
  -f /opt/dokanflow/bootstrap.sql
