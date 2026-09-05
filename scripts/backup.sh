#!/usr/bin/env bash
# PostgreSQL 덤프를 만들고(선택) GCS 로 올린다. 90일 지난 로컬 덤프는 지운다.
#   DATABASE_URL=postgres://... ./scripts/backup.sh [백업 디렉터리] [gs://버킷/경로]
# cron 예: 0 3 * * * DATABASE_URL=... /app/scripts/backup.sh /backups gs://byeolha-backups/db
set -euo pipefail
DIR="${1:-./backups}"
GCS="${2:-}"
: "${DATABASE_URL:?DATABASE_URL 이 필요합니다}"
mkdir -p "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DIR/byeolha-$STAMP.dump"
pg_dump --format=custom --no-owner --no-privileges --file "$FILE" "$DATABASE_URL"
echo "덤프 완료: $FILE ($(du -h "$FILE" | cut -f1))"
if [ -n "$GCS" ]; then
  gsutil -q cp "$FILE" "$GCS/"
  echo "업로드 완료: $GCS/$(basename "$FILE")"
fi
find "$DIR" -name 'byeolha-*.dump' -mtime +90 -delete
# 복구: pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" byeolha-YYYYmmdd-HHMMSS.dump
