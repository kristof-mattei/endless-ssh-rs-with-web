#!/usr/bin/env bash
set -e

psql --set=ON_ERROR_STOP=1 --set=postgres_password="$POSTGRES_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE USER "endless-ssh-rs" WITH PASSWORD :'postgres_password';
  CREATE DATABASE "endless-ssh-rs" WITH OWNER "endless-ssh-rs";
  -- GRANT ALL PRIVILEGES ON DATABASE "endless-ssh-rs" TO "endless-ssh-rs";
EOSQL
