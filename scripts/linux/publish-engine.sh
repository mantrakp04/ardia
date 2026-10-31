#!/usr/bin/env bash
set -euo pipefail
usage='usage: scripts/linux/publish-engine.sh --out <chromium out dir> --source <ardia checkout> [--dest DIR] [--repo OWNER/NAME] [--upload]

Packs a Linux Chromium build into the prebuilt engine archive CI fetches with
packages/ardiacore/scripts/fetch-engine.sh --arch linux-x86_64:
ArdiaCore-<tree12>-linux-x64.tar.xz and its .sha256, where tree is the git tree
of <source>/engine (a git checkout with a clean engine/, or a plain copy beside
a <source>.commit file).

  --out DIR        the Chromium out dir, e.g. out/Release_GN_linux_x64; copied
                   under the chromium lock and never modified
  --source DIR     the Ardia source tree the engine was built from
  --dest DIR       where the archive goes (default: a new temporary dir);
                   existing archives are never overwritten
  --repo SLUG      the GitHub repo for --upload (default: $ARDIACORE_PREBUILT_REPO
                   or mckamyk/ardia)
  --upload         create the engine-<tree12> prerelease if needed, upload the
                   archive and its .sha256, and add the row to
                   packages/ardiacore/prebuilt-engines-linux.tsv (not committed)

Prints the archive path, then the table row.'
for arg in "$@"; do
  case "$arg" in -h|--help) echo "$usage"; exit 0 ;; esac
done
[ $# -gt 0 ] || { echo "$usage" >&2; exit 64; }
for tool in git python3 strip readelf tar xz flock; do
  command -v "$tool" >/dev/null || { echo "publish-engine.sh: $tool is required" >&2; exit 69; }
done
exec python3 "$(cd "$(dirname "$0")" && pwd)/publish_engine.py" "$@"
