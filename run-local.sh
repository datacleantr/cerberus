#!/usr/bin/env bash
# Cerberus'u lokalde çalıştırır: gerekirse local Postgres'i ayağa kaldırır,
# hazır olmasını bekler ve Next.js dev sunucusunu başlatır.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PG_BIN="/opt/homebrew/opt/postgresql@14/bin"
PGDATA="$HOME/.cerberus-local-pgdata"
PG_PORT=5433
PG_SOCKET_DIR="/tmp"

cd "$PROJECT_DIR"

echo "==> Local Postgres kontrol ediliyor (port $PG_PORT)..."
if "$PG_BIN/pg_isready" -h "$PG_SOCKET_DIR" -p "$PG_PORT" >/dev/null 2>&1; then
  echo "    Zaten çalışıyor."
else
  if [ ! -d "$PGDATA" ]; then
    echo "HATA: $PGDATA bulunamadı. Local Postgres cluster'ı önce kurulmalı." >&2
    exit 1
  fi
  echo "    Başlatılıyor..."
  "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -o "-p $PG_PORT -k $PG_SOCKET_DIR" start
  for i in $(seq 1 20); do
    "$PG_BIN/pg_isready" -h "$PG_SOCKET_DIR" -p "$PG_PORT" >/dev/null 2>&1 && break
    sleep 0.5
  done
  "$PG_BIN/pg_isready" -h "$PG_SOCKET_DIR" -p "$PG_PORT" >/dev/null 2>&1 || {
    echo "HATA: Postgres başlatılamadı, $PGDATA/server.log dosyasına bakın." >&2
    exit 1
  }
  echo "    Hazır."
fi

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "==> node_modules yok, npm ci çalıştırılıyor..."
  npm ci
fi

echo "==> Next.js dev sunucusu başlatılıyor (http://localhost:3000)..."
echo "    Durdurmak için Ctrl+C"
exec npm run dev
