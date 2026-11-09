#!/bin/bash
set -u

rm -rf /data/clickhouse
mkdir -p /data/ch

ulimit -n 1048576 2>/dev/null || ulimit -Sn "$(ulimit -Hn)"
echo "[ac] open files: $(ulimit -Sn) (hard $(ulimit -Hn))"

/entrypoint.sh &
server=$!
trap 'kill -TERM $server 2>/dev/null' TERM INT

for _ in $(seq 1 120); do
  clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" -q "SELECT 1" >/dev/null 2>&1 && break
  sleep 1
done
if ! clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" --multiquery < /etc/ac/schema.sql; then
  echo "[ac] schema FAILED: stopping the server so the deploy fails instead of serving the old schema" >&2
  kill -TERM $server
  wait $server
  exit 1
fi
echo "[ac] schema applied"

ch() { clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" -q "$1"; }

backfill_typed_columns() {
  local table=$1 probe=$2 columns=$3
  local unfilled pending
  unfilled=$(ch "
    SELECT count() FROM system.parts AS p
    WHERE p.active AND p.database = 'telemetry' AND p.table = '$table'
      AND p.name NOT IN (SELECT name FROM system.parts_columns
                         WHERE active AND database = 'telemetry' AND table = '$table' AND column = '$probe')")
  pending=$(ch "SELECT count() FROM system.mutations WHERE database = 'telemetry' AND table = '$table' AND NOT is_done")
  if [ "${unfilled:-0}" != "0" ] && [ "${pending:-1}" = "0" ]; then
    ch "ALTER TABLE telemetry.$table $columns" && echo "[ac] telemetry.$table: backfilling typed columns in $unfilled parts"
  fi
}

backfill_typed_columns otel_logs Country "$(printf 'MATERIALIZE COLUMN %s, ' ServiceVersion Lib Host Os DeviceType Browser AppVersion Version Pathname ReferringDomain Country | sed 's/, $//')"
backfill_typed_columns posthog_events country "$(printf 'MATERIALIZE COLUMN %s, ' lib host os device_type browser app_version version pathname referring_domain country | sed 's/, $//')"

for table in $(ch "
  SELECT DISTINCT table FROM system.parts
  WHERE active AND database = 'telemetry' AND part_type = 'Wide' AND bytes_on_disk < 1073741824
    AND table NOT IN (SELECT table FROM system.mutations WHERE database = 'telemetry' AND NOT is_done)"); do
  clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" -q "OPTIMIZE TABLE telemetry.$table FINAL" \
    && echo "[ac] telemetry.$table merged into compact parts"
done

wait $server
