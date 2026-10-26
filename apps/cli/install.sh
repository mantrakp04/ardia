#!/bin/sh
# Installs the ardia command, which controls a running Ardia from the terminal.
#
#   install.sh [--version V] [--sha256 DIGEST] [--uninstall]
#   install.sh -h | --help
#
# --version V        install that release (default: the latest release that ships the CLI).
# --sha256 DIGEST    the tarball's digest; required for a download (the app passes the one pinned in its signed bundle).
# --uninstall        remove the installed CLI and its ardia link.
#
# Installs into ${ARDIA_CLI_HOME:-~/Library/Application Support/Ardia/CLI}/<version>, points its `current` link
# there and links ${ARDIA_CLI_BIN_DIR:-~/.local/bin}/ardia to current/bin/ardia. When the default bin dir isn't on
# the login shell's PATH, it adds one PATH line to ~/.zprofile (~/.bash_profile for bash), once.
# Re-running it upgrades: a version that is already current is left alone; a new one is verified, staged in
# <version>.partial, renamed, and `current` is swapped atomically (a running ardia keeps its old dir). It keeps the
# current and the previous version and prunes the rest, except versions a running ardia uses (it leaves a lease in
# <version>/.leases/<pid>, live while that pid runs and started before the lease was written). Two runs never overlap:
# each holds a flock on $ARDIA_CLI_HOME/.lock (lockf), which the kernel drops when the run exits.
# The installed version is `basename "$(readlink "$ARDIA_CLI_HOME/current")"`.
# Downloads are https only, and never trust a checksum from the same place as the tarball: without --sha256 it refuses
# to download. ARDIA_CLI_URL overrides the tarball URL; a file:// one may go without --sha256, and its checksum is read
# from $ARDIA_CLI_URL.sha256.
#
# Prints one line per event: `step resolve|download|verify|install|link`, `version <v>`, `path <rc file>`,
# then `installed <bin path>` (or `uninstalled`), or `error <message>` and exits 1.
set -eu
umask 022

repo=mantrakp04/ardia
asset_suffix=-macos-arm64.tar.gz
version_pattern='^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-[a-z]{1,16}\.[0-9]{1,4})?$'
cli_home=${ARDIA_CLI_HOME:-$HOME/Library/Application Support/Ardia/CLI}
default_bin_dir=$HOME/.local/bin
bin_dir=${ARDIA_CLI_BIN_DIR:-$default_bin_dir}
version=
pinned_sha=
uninstall=0
work=
reported=0

help() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit 0
}

fail() {
  reported=1
  printf 'error %s\n' "$*"
  exit 1
}

finish() {
  status=$?
  [ -n "$work" ] && rm -rf "$work"
  if [ "$status" -ne 0 ] && [ "$reported" -eq 0 ]; then
    printf 'error install stopped (exit %s)\n' "$status"
  fi
}
trap finish EXIT
trap 'exit 130' INT TERM HUP

is_version() {
  printf '%s\n' "$1" | grep -Eq "$version_pattern"
}

while [ $# -gt 0 ]; do
  case $1 in
    --version) [ $# -ge 2 ] || fail "--version needs a value"; version=${2#v}; shift 2 ;;
    --version=*) version=${1#--version=}; version=${version#v}; shift ;;
    --sha256) [ $# -ge 2 ] || fail "--sha256 needs a value"; pinned_sha=$2; shift 2 ;;
    --sha256=*) pinned_sha=${1#--sha256=}; shift ;;
    --uninstall) uninstall=1; shift ;;
    -h|--help) help ;;
    *) fail "unknown option: $1" ;;
  esac
done

if [ -n "$version" ] && ! is_version "$version"; then
  fail "bad version: $version"
fi
if [ -n "$pinned_sha" ] && ! printf '%s\n' "$pinned_sha" | grep -Eq '^[0-9a-f]{64}$'; then
  fail "bad --sha256 digest: $pinned_sha"
fi

if [ -n "${ARDIA_CLI_URL:-}" ]; then
  protocols==https,file
else
  protocols==https
fi

fetch() {
  curl -fsSL --proto "$protocols" --proto-redir =https --retry 2 --connect-timeout 15 "$@"
}

take_lock() {
  if [ -d "$cli_home/.lock" ] && ! [ -L "$cli_home/.lock" ]; then
    rm -rf "$cli_home/.lock" "$cli_home/.lock-takeover"
  fi
  exec 9>>"$cli_home/.lock" || fail "couldn't open $cli_home/.lock"
  /usr/bin/lockf -s -t 120 9 || fail "another install is still running"
}

points_into_cli_home() {
  [ -L "$1" ] || return 1
  case $(readlink "$1") in
    "$cli_home"/*) return 0 ;;
  esac
  return 1
}

check_bin_free() {
  if { [ -e "$bin_dir/ardia" ] || [ -L "$bin_dir/ardia" ]; } && ! points_into_cli_home "$bin_dir/ardia"; then
    fail "$bin_dir/ardia already exists and isn't this CLI's link; move it away and run this again"
  fi
}

link_bin() {
  target=$cli_home/current/bin/ardia
  [ -L "$bin_dir/ardia" ] && [ "$(readlink "$bin_dir/ardia")" = "$target" ] && return 0
  printf 'step link\n'
  mkdir -p "$bin_dir" || fail "couldn't create $bin_dir"
  check_bin_free
  ln -sfh "$target" "$bin_dir/.ardia.$$" || fail "couldn't create the ardia link"
  mv -fh "$bin_dir/.ardia.$$" "$bin_dir/ardia" || { rm -f "$bin_dir/.ardia.$$"; fail "couldn't link $bin_dir/ardia"; }
}

lease_live() {
  holder=${1##*/}
  case $holder in
    ''|*[!0-9]*) return 1 ;;
  esac
  started=$(LC_ALL=C ps -o lstart= -p "$holder" 2>/dev/null) || return 1
  [ -n "$started" ] || return 1
  started=$(LC_ALL=C date -j -f "%a %b %e %T %Y" "$started" +%s 2>/dev/null) || return 0
  leased=$(stat -f %m "$1" 2>/dev/null) || return 1
  [ "$started" -le $((leased + 1)) ]
}

in_use() {
  for lease in "$1"/.leases/*; do
    [ -f "$lease" ] || continue
    lease_live "$lease" && return 0
    rm -f "$lease"
  done
  return 1
}

is_cli_entry() {
  name=${1##*/}
  case $name in
    current) [ -L "$1" ] ;;
    *.partial) is_version "${name%.partial}" ;;
    *) is_version "$name" && [ -d "$1" ] ;;
  esac
}

check_archive() {
  tar -tzf "$1" >"$work/names" 2>/dev/null || fail "couldn't read the tarball"
  if grep -q -e '\\' -e ' -> ' -e '[[:cntrl:]]' "$work/names"; then
    fail "the tarball has entry names with control characters, backslashes or arrows"
  fi
  if grep -Ev "^ardia-cli-$version(/|$)" "$work/names" | grep -q .; then
    fail "the tarball has entries outside ardia-cli-$version/"
  fi
  if grep -Eq '(^|/)\.\.(/|$)' "$work/names"; then
    fail "the tarball has .. entries"
  fi
  tar -tvzf "$1" >"$work/listing" 2>/dev/null || fail "couldn't read the tarball"
  if grep -Eq '^h| link to ' "$work/listing"; then
    fail "the tarball has hard links"
  fi
  grep -E '^l' "$work/listing" | awk '{ i = index($0, " -> "); print (i ? substr($0, i + 4) : "/") }' >"$work/targets"
  if grep -Eq '^/|(^|/)\.\.(/|$)|\\' "$work/targets"; then
    fail "the tarball has links that point outside it"
  fi
}

check_tree() {
  if [ -n "$(find "$1" -name '*[[:cntrl:]]*' -print -quit)" ]; then
    fail "the tarball has names with control characters"
  fi
  if [ -n "$(find "$1" -type f -links +1 -print -quit)" ]; then
    fail "the tarball has hard links"
  fi
  find "$1" -type l -exec sh -c '
    for link do
      case $(readlink "$link") in
        /*|..|../*|*/../*|*/..|*[[:cntrl:]]*) exit 1 ;;
      esac
    done' sh {} + || fail "the tarball has a link that points outside it"
}

if [ "$uninstall" -eq 1 ]; then
  printf 'step uninstall\n'
  if points_into_cli_home "$bin_dir/ardia"; then
    rm -f "$bin_dir/ardia" || fail "couldn't remove $bin_dir/ardia"
  fi
  if [ -d "$cli_home" ]; then
    take_lock
    for entry in "$cli_home"/* "$cli_home"/.install.*; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue
      case ${entry##*/} in
        .install.*) ;;
        *) is_cli_entry "$entry" || continue ;;
      esac
      rm -rf "$entry" || fail "couldn't remove $entry"
    done
    rmdir "$cli_home" 2>/dev/null || true
  fi
  reported=1
  printf 'uninstalled\n'
  exit 0
fi

[ "$(uname -s)" = Darwin ] || fail "the ardia CLI runs on macOS only"
[ "$(uname -m)" = arm64 ] || fail "the ardia CLI runs on Apple silicon only, not $(uname -m)"

printf 'step resolve\n'
if [ -n "${ARDIA_CLI_URL:-}" ]; then
  url=$ARDIA_CLI_URL
  if [ -z "$version" ]; then
    name=${url##*/}
    version=${name#ardia-cli-}
    version=${version%"$asset_suffix"}
  fi
elif [ -n "$version" ]; then
  url=https://github.com/$repo/releases/download/v$version/ardia-cli-$version$asset_suffix
else
  pattern="https://github\.com/$repo/releases/download/v[0-9a-z.-]*/ardia-cli-[0-9a-z.-]*-macos-arm64\.tar\.gz"
  url=$(fetch https://api.github.com/repos/$repo/releases/latest 2>/dev/null | grep -o "$pattern" | head -n 1 || true)
  if [ -z "$url" ]; then
    url=$(fetch "https://api.github.com/repos/$repo/releases?per_page=30" 2>/dev/null | grep -o "$pattern" | head -n 1 || true)
  fi
  [ -n "$url" ] || fail "no Ardia release ships the CLI yet (or GitHub is unreachable)"
  name=${url##*/}
  version=${name#ardia-cli-}
  version=${version%"$asset_suffix"}
fi
is_version "$version" || fail "bad version: $version"
case $url in
  file://*) ;;
  *) [ -n "$pinned_sha" ] || fail "no --sha256: install the ardia command from Ardia (Settings › Advanced), which pins its digest" ;;
esac
printf 'version %s\n' "$version"
check_bin_free

mkdir -p "$cli_home" || fail "couldn't create $cli_home"
take_lock
work=$(mktemp -d "${TMPDIR:-/tmp}/ardia-cli-install.XXXXXX") || fail "couldn't create a temporary folder"
chmod 700 "$work"

previous=$(readlink "$cli_home/current" 2>/dev/null || true)
if [ "$previous" = "$version" ] && [ -x "$cli_home/$version/bin/ardia" ]; then
  link_bin
  reported=1
  printf 'installed %s\n' "$bin_dir/ardia"
  exit 0
fi
is_version "$previous" || previous=

printf 'step download\n'
fetch -o "$work/cli.tar.gz" "$url" 2>"$work/curl.err" || fail "download failed: $url ($(tail -n 1 "$work/curl.err"))"
if [ -n "$pinned_sha" ]; then
  expected=$pinned_sha
else
  expected=$(fetch "$url.sha256" 2>"$work/curl.err" | awk '{ print $1; exit }') || fail "checksum download failed: $url.sha256"
fi

printf 'step verify\n'
printf '%s\n' "$expected" | grep -Eq '^[0-9a-f]{64}$' || fail "bad checksum file: $url.sha256"
actual=$(shasum -a 256 "$work/cli.tar.gz" | awk '{ print $1 }')
[ "$actual" = "$expected" ] || fail "checksum mismatch: expected $expected, got $actual"
check_archive "$work/cli.tar.gz"

printf 'step install\n'
staged=$cli_home/$version.partial
dest=$cli_home/$version
rm -rf "$staged"
mkdir "$staged" || fail "couldn't create $staged"
tar -xzf "$work/cli.tar.gz" -C "$staged" --strip-components 1 --no-same-owner "ardia-cli-$version" \
  || fail "couldn't extract ardia-cli-$version from the tarball"
check_tree "$staged"
[ -x "$staged/bin/ardia" ] || fail "the tarball has no ardia-cli-$version/bin/ardia"
xattr -dr com.apple.quarantine "$staged" 2>/dev/null || true
"$staged/bin/ardia" --version >"$work/check.out" 2>&1 9>&- || fail "the downloaded ardia doesn't run: $(tail -n 1 "$work/check.out")"
if [ -d "$dest" ] && ! [ -L "$dest" ] && [ -x "$dest/bin/ardia" ] && in_use "$dest"; then
  rm -rf "$staged"
else
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    mv "$dest" "$cli_home/.install.replaced.$$" || fail "couldn't replace $dest"
    rm -rf "$cli_home/.install.replaced.$$"
  fi
  mv "$staged" "$dest" || fail "couldn't move the CLI into $dest"
fi
ln -sfh "$version" "$cli_home/.install.current.$$" || fail "couldn't create the current link"
mv -fh "$cli_home/.install.current.$$" "$cli_home/current" || fail "couldn't switch $cli_home/current"
for entry in "$cli_home"/*; do
  case ${entry##*/} in
    current|"$version"|"$previous") continue ;;
  esac
  if is_cli_entry "$entry" && ! in_use "$entry"; then
    rm -rf "$entry"
  fi
done

link_bin

if [ "$bin_dir" = "$default_bin_dir" ]; then
  login_shell=$(dscl . -read "/Users/$(id -un)" UserShell 2>/dev/null | awk '{ print $2 }')
  [ -x "${login_shell:-}" ] || login_shell=${SHELL:-/bin/zsh}
  login_path=$(env -i HOME="$HOME" USER="$(id -un)" LOGNAME="$(id -un)" TERM=dumb "$login_shell" -l -c 'printf "%s" "$PATH"' </dev/null 2>/dev/null 9>&- || true)
  case :$login_path: in
    *:"$bin_dir":*|*:"$bin_dir/":*) ;;
    *)
      case ${login_shell##*/} in
        bash) rc=$HOME/.bash_profile ;;
        *) rc=$HOME/.zprofile ;;
      esac
      line='export PATH="$HOME/.local/bin:$PATH"'
      if ! [ -f "$rc" ] || ! grep -qxF "$line" "$rc"; then
        if [ -s "$rc" ] && [ -n "$(tail -c 1 "$rc")" ]; then
          printf '\n' >>"$rc" || fail "couldn't write $rc"
        fi
        printf '%s\n' "$line" >>"$rc" || fail "couldn't write $rc"
        printf 'path %s\n' "$rc"
      fi
      ;;
  esac
fi

reported=1
printf 'installed %s\n' "$bin_dir/ardia"
