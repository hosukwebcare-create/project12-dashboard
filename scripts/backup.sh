#!/bin/sh
# PostgreSQL 덤프를 만들고(선택) GCS 로 올린다. 90일 지난 로컬 덤프는 지운다.
#   DATABASE_URL=postgres://... ./scripts/backup.sh [백업 디렉터리] [gs://버킷/경로]
# cron 예: 0 3 * * * DATABASE_URL=... /app/scripts/backup.sh /backups gs://byeolha-backups/db
# docker compose 의 backup 서비스(postgres:16-alpine, sh)에서도 그대로 돈다. GCS 업로드는 gsutil 이 있을 때만.
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail
DIR="${1:-./backups}"
GCS="${2:-}"
: "${DATABASE_URL:?DATABASE_URL 이 필요합니다}"
mkdir -p "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DIR/byeolha-$STAMP.dump"
pg_dump --format=custom --no-owner --no-privileges --file "$FILE" "$DATABASE_URL"
echo "덤프 완료: $FILE ($(du -h "$FILE" | cut -f1))"
if [ -n "$GCS" ]; then
  command -v gsutil >/dev/null || { echo "gsutil 이 없어 GCS 업로드를 건너뜁니다"; exit 0; }
  gsutil -q cp "$FILE" "$GCS/"
  echo "업로드 완료: $GCS/$(basename "$FILE")"
fi
find "$DIR" -name 'byeolha-*.dump' -mtime +90 -delete
# 복구: pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" byeolha-YYYYmmdd-HHMMSS.dump
