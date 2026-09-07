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
# --enable-row-security: 업무 테이블에 FORCE ROW LEVEL SECURITY 가 걸려 있어, 앱 전용 계정으로는
# 이 옵션 없이 덤프가 거부된다. 정책은 지점 컨텍스트(app.rls)가 없으면 모든 행을 통과시키므로
# 이 계정으로도 전체가 덤프된다. 뜬 뒤에는 아래 건수 확인으로 누락이 없는지 본다.
pg_dump --format=custom --no-owner --no-privileges --enable-row-security --file "$FILE" "$DATABASE_URL"
echo "덤프 완료: $FILE ($(du -h "$FILE" | cut -f1))"
# 빈 덤프를 백업이라고 믿는 일이 없도록 주요 테이블 건수를 DB 와 덤프에서 각각 센다
DB_MEMBERS="$(psql "$DATABASE_URL" -tAc 'select count(*) from members' 2>/dev/null || echo '?')"
DUMP_TABLES="$(pg_restore --list "$FILE" | grep -c 'TABLE DATA' || true)"
echo "  회원 $DB_MEMBERS명 · 덤프에 담긴 테이블 $DUMP_TABLES개"
[ "$DUMP_TABLES" -lt 20 ] && echo "  경고: 테이블 수가 적습니다. 덤프가 온전한지 확인하세요" >&2
if [ -n "$GCS" ]; then
  command -v gsutil >/dev/null || { echo "gsutil 이 없어 GCS 업로드를 건너뜁니다"; exit 0; }
  gsutil -q cp "$FILE" "$GCS/"
  echo "업로드 완료: $GCS/$(basename "$FILE")"
fi
find "$DIR" -name 'byeolha-*.dump' -mtime +90 -delete
# 복구: pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" byeolha-YYYYmmdd-HHMMSS.dump
