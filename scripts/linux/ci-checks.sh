#!/usr/bin/env bash
set -uo pipefail
usage='usage: scripts/linux/ci-checks.sh [--jobs N] [--logs DIR]

Runs the Linux checks that need no engine: the apps/linux typecheck, host,
symbol, module-graph and acceptance self-tests, the UI build, and the Python
and Node fixture suites under engine/. The engine/ardiacore-linux modules run
in parallel, N at a time (default: the CPU count), each under a 10-minute
deadline. Every check runs; the exit status is non-zero if any failed, and
each check leaves its output in DIR (default: a temporary directory).'
jobs=$(nproc)
logs=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) echo "$usage"; exit 0 ;;
    --jobs) jobs=$2; shift 2 ;;
    --logs) logs=$2; shift 2 ;;
    *) echo "$usage" >&2; exit 64 ;;
  esac
done
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root" || exit 1
[ -n "$logs" ] || logs=$(mktemp -d)
mkdir -p "$logs"
export PYTHONDONTWRITEBYTECODE=1
failed=()

check() {
  local name=$1 started status
  shift
  started=$(date +%s)
  timeout 900 "$@" >"$logs/$name.log" 2>&1
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "ok    $(( $(date +%s) - started ))s  $name"
  else
    echo "FAIL  $(( $(date +%s) - started ))s  $name (exit $status, $logs/$name.log)"
    tail -40 "$logs/$name.log" | sed 's/^/      /'
    failed+=("$name")
  fi
}

check linux-typecheck pnpm --filter @ardia/linux typecheck
check linux-test-host pnpm --filter @ardia/linux test:host
check linux-test-symbols pnpm --filter @ardia/linux test:symbols
check linux-test-graph pnpm --filter @ardia/linux test:graph
check linux-acceptance-self-test pnpm --filter @ardia/linux acceptance:self-test
check linux-build pnpm --filter @ardia/linux build
check patches-build-tests python3 -m unittest discover -s engine/patches/build/tests
check chromium-ardia-tests python3 -m unittest discover -s engine/chromium/src/chrome/browser/ardia/tests
check ardiacore-linux-bootstrap node --test engine/ardiacore-linux/tests/bootstrap.test.mjs

modules=$(cd engine/ardiacore-linux/tests && ls test_*.py | sed 's/\.py$//')
started=$(date +%s)
results=$(cd engine/ardiacore-linux/tests && printf '%s\n' $modules | xargs -P "$jobs" -I{} sh -c \
  'timeout 600 python3 -m unittest {} >"$1/ardiacore-linux-{}.log" 2>&1; echo "$? {}"' sh "$logs")
module_failures=$(awk '$1 != 0 { print $2 }' <<<"$results")
if [ -z "$module_failures" ]; then
  echo "ok    $(( $(date +%s) - started ))s  ardiacore-linux-tests ($(wc -l <<<"$results") modules)"
else
  for module in $module_failures; do
    echo "FAIL  ardiacore-linux-tests $module ($logs/ardiacore-linux-$module.log)"
    tail -40 "$logs/ardiacore-linux-$module.log" | sed 's/^/      /'
    failed+=("ardiacore-linux-$module")
  done
fi

if [ "${#failed[@]}" -gt 0 ]; then
  echo "failed: ${failed[*]}"
  exit 1
fi
echo "all Linux checks passed"
