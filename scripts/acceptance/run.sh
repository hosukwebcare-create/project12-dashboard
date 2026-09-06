#!/bin/sh
# 검수 워크스루 한 번에 돌리기: DB 초기화·시드 → 수신기·운영 빌드 기동 → 워크스루 → 정리.
#   sh scripts/acceptance/run.sh [출력 디렉터리]
# 전제: 로컬 Postgres(byeolha_e2e, 앱 역할 byeolha_app), pnpm build 완료(.next/standalone), 사설망 IP 하나.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/acceptance-out}"
mkdir -p "$OUT/evidence" "$OUT/storage"
: > "$OUT/received.jsonl"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I | awk '{print $1}')"
PORT=3210
DB=postgres://localhost:5432/byeolha_e2e
APP_DB=postgres://byeolha_app:byeolha_app@localhost:5432/byeolha_e2e

cleanup() { kill "${SERVER_PID:-}" "${RECV_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT

echo "== DB 초기화·시드"
(cd "$ROOT" && pnpm -s db:reset:e2e >/dev/null)
SEED="$(cd "$ROOT" && DATABASE_URL=$DB pnpm -s exec tsx src/db/seed.ts)"
BOARD="$(printf '%s' "$SEED" | grep -o '/board/[0-9a-f-]*?t=[0-9a-f]*')"
DT2="$(printf '%s' "$BOARD" | sed 's#/board/\([^?]*\)?t=.*#\1#')"
TOKEN="$(printf '%s' "$BOARD" | sed 's#.*t=##')"

echo "== 수신기 (:4599, 메신저 웹훅·알림톡 딜러 흉내)"
node "$ROOT/scripts/acceptance/receiver.mjs" "$OUT/received.jsonl" >"$OUT/receiver.log" 2>&1 &
RECV_PID=$!

echo "== 운영 빌드 기동 (:$PORT)"
(cd "$ROOT/.next/standalone" && NODE_ENV=production PORT=$PORT TZ=Asia/Seoul \
  DATABASE_URL="$APP_DB" SESSION_SECRET="acceptance-secret-acceptance-secret-1234" AUTO_MIGRATE=false \
  STORAGE_DRIVER=local STORAGE_DIR="$OUT/storage" WEBHOOK_ALLOW_PRIVATE=true \
  ALIMTALK_PROVIDER=http ALIMTALK_ENDPOINT="http://$LAN_IP:4599/alimtalk" ALIMTALK_API_KEY="dealer-test-key" ALIMTALK_SENDER_KEY="sender-test" \
  HERO_WEBHOOK_SECRET="hero-acceptance-secret" JOB_SECRET="job-acceptance-secret" RETENTION_DAYS=1 \
  SCHEDULER=on SCHEDULER_OUTBOX_SEC=10 SCHEDULER_ALIMTALK_SEC=10 \
  node server.js >"$OUT/server.log" 2>&1) &
SERVER_PID=$!
curl -s -m 5 --retry 20 --retry-delay 2 --retry-connrefused "http://localhost:$PORT/api/health" >/dev/null

echo "== 워크스루"
cd "$ROOT"
ACC_DIR="$OUT" ACC_DT2="$DT2" ACC_BOARD_TOKEN="$TOKEN" ACC_RECEIVER="http://$LAN_IP:4599" ACC_BASE="http://localhost:$PORT" ACC_DB="$DB" \
  pnpm -s exec tsx scripts/acceptance/walkthrough.ts 2>&1 | tee "$OUT/walkthrough.log"
grep '^\[batch\]' "$OUT/server.log" > "$OUT/batch.log" || true
echo "== 결과: $OUT/results.json · 증거: $OUT/evidence/"
