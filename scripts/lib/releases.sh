REPO="mantrakp04/ardia"
REPO_URL="https://github.com/$REPO"
LATEST_DOWNLOAD_URL="$REPO_URL/releases/latest/download"
NIGHTLY_DMG_URL="$REPO_URL/releases/download/nightly/Ardia-Nightly.dmg"
RELEASE_NOTES_URL="https://ardia.dev/release-notes"
APPCAST_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.claude/skills/release/scripts/appcast.py"

channel_of() {
  if [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]+$ ]]; then
    echo nightly
  elif [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo stable
  else
    echo "error: $1 is neither a stable (<major>.<minor>.<patch>) nor a nightly (<next stable>-nightly.<n>) version" >&2
    return 1
  fi
}

appcast() { python3 -I "$APPCAST_PY" "$@"; }

latest_stable_tag() {
  local tag
  tag="$(gh release view -R "$REPO" --json tagName -q .tagName)"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "error: the latest release is $tag, not a stable one: the feed lives on the latest stable release" >&2
    return 1
  }
  echo "$tag"
}

download_live_feed() {
  local tag="$1" dir="$2" names
  names="$(gh release view "$tag" -R "$REPO" --json assets -q '.assets[].name')" \
    || { echo "error: couldn't list $tag's assets" >&2; exit 1; }
  grep -qx appcast.xml <<<"$names" || return 1
  mkdir -p "$dir"
  gh release download "$tag" -R "$REPO" -p appcast.xml -D "$dir" --clobber
}
