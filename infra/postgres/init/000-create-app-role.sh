#!/usr/bin/env sh
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$CI_DOCTOR_APP_PASSWORD" <<'SQL'
CREATE ROLE ci_doctor_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
SQL
