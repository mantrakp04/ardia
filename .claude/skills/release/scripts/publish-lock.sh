lock_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
. "$lock_root/scripts/lib/releases.sh"
lock_repo_url="$REPO_URL.git"
lock_sha=""
lock_max_age=7200
lock_fail() { echo "error: $*" >&2; exit 1; }
if [ -n "${GITHUB_RUN_ID:-}" ]; then
  lock_holder="CI run ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-$REPO}/actions/runs/$GITHUB_RUN_ID"
else
  lock_holder="$(id -un)@$(hostname -s)"
fi
lock_holder="$(LC_ALL=C tr -cd 'A-Za-z0-9@._:/ -' <<<"$lock_holder")"

lock_git() {
  git -C "$lock_root" -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"
}

lock_push() {
  local expect="$1" refspec="$2"
  lock_git push --quiet --porcelain --force-with-lease="$lock_ref:$expect" "$lock_repo_url" "$refspec" >/dev/null 2>&1
}

lock_remote_sha() {
  local out
  out="$(lock_git ls-remote --exit-code "$lock_repo_url" "$lock_ref" 2>/dev/null)" || return 1
  awk '{ print $1; exit }' <<<"$out"
}

lock_message() {
  lock_git fetch --quiet --no-tags "$lock_repo_url" "$1" 2>/dev/null || return 1
  lock_git cat-file commit "$1" 2>/dev/null | awk 'found { print } /^$/ { found = 1 }'
}

new_lock_commit() {
  local empty_tree
  empty_tree="$(lock_git hash-object -t tree -w /dev/null)"
  lock_git commit-tree "$empty_tree" -m "publish lock: $1 by $lock_holder (pid $$) since $(date -u +%s)"
}

take_lock() {
  local purpose="$1" dry="$2" break_lock="$3" commit existing message since now age
  lock_name="release-lock"
  if [ -n "${PUBLISH_LOCK:-}" ]; then
    [ "$dry" = 1 ] || lock_fail "PUBLISH_LOCK renames the lock for dry runs only: every real publish shares release-lock"
    [[ "$PUBLISH_LOCK" =~ ^[A-Za-z0-9._-]+$ ]] || lock_fail "PUBLISH_LOCK must be a plain branch name"
    lock_name="$PUBLISH_LOCK"
  fi
  lock_ref="refs/heads/$lock_name"
  commit="$(new_lock_commit "$purpose")"
  if lock_push "" "$commit:$lock_ref"; then
    lock_sha="$commit"
    echo "took the publish lock ($lock_name) as $lock_holder"
    return 0
  fi
  existing="$(lock_remote_sha)" \
    || lock_fail "couldn't take the publish lock ($lock_name), and couldn't read it either: check git's access to $REPO"
  message="$(lock_message "$existing")" || message=""
  since="$(sed -n 's/^publish lock: .* since \([0-9][0-9]*\)$/\1/p' <<<"$message" | head -1)"
  now="$(date -u +%s)"
  if [ -z "$since" ] || [ "$since" -gt "$now" ]; then
    lock_fail "publishing is locked ($lock_name at ${existing:0:12}), and its holder and time can't be read: it can't be broken; check the branch by hand"
  fi
  age=$(( now - since ))
  if [ "$age" -lt "$lock_max_age" ]; then
    lock_fail "publishing is locked by $message ($((age / 60)) min ago, branch $lock_name): wait for it to finish (a lock under 2 h can't be broken)"
  fi
  [ "$break_lock" = 1 ] \
    || lock_fail "publishing is locked by $message ($((age / 60)) min ago, branch $lock_name): if that publish is dead, run again with --break-lock"
  echo "breaking a $((age / 60)) min old publish lock: $message"
  lock_push "$existing" "$commit:$lock_ref" \
    || lock_fail "the publish lock ($lock_name) changed while it was being broken: someone else holds it now"
  lock_sha="$commit"
  echo "took the publish lock ($lock_name) as $lock_holder"
}

release_lock() {
  [ -n "$lock_sha" ] || return 0
  if lock_push "$lock_sha" ":$lock_ref"; then
    echo "released the publish lock ($lock_name)"
  else
    echo "warning: the publish lock ($lock_name) is no longer this run's, so it was left alone" >&2
  fi
  lock_sha=""
}
