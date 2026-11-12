infra_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEXCLAVE_PROJECT_ID="49be2e2e-87c4-433e-b42f-f255854bff56"

hexclave_deploy() {
  local cli
  if [ -n "${HEXCLAVE:-}" ]; then
    read -r -a cli <<<"$HEXCLAVE"
  elif [ -x "$infra_dir/hexclave-cli/node_modules/.bin/hexclave" ]; then
    cli=("$infra_dir/hexclave-cli/node_modules/.bin/hexclave")
  else
    cli=(npx "@hexclave/cli@$(node -p "require('$infra_dir/hexclave-cli/package.json').dependencies['@hexclave/cli']")")
  fi
  "${cli[@]}" deploy --cloud-project-id "$HEXCLAVE_PROJECT_ID" "$@"
}
