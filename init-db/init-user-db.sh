#!/usr/bin/env bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE USER "endless-ssh-rs" WITH PASSWORD '$POSTGRES_PASSWORD';
  CREATE DATABASE "endless-ssh-rs" WITH OWNER "endless-ssh-rs";
  -- GRANT ALL PRIVILEGES ON DATABASE "endless-ssh-rs" TO "endless-ssh-rs";
EOSQL
