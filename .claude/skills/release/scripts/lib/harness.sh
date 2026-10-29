harness_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
harness_root="$(git -C "$harness_dir" rev-parse --show-toplevel)"

signing_identity() {
  local identity
  identity="$(security find-identity -v -p codesigning | awk '/"Apple Development/ { print $2; exit }')"
  [ -n "$identity" ] || { echo "error: no Apple Development identity to sign the test copies with" >&2; return 1; }
  printf '%s\n' "$identity"
}

test_signing_key() {
  local work="$1"
  [ -x "$work/ed25519" ] || swiftc -O "$harness_dir/ed25519.swift" -o "$work/ed25519" 2>/dev/null
  "$work/ed25519" generate "$work/key"
}

build_sparkle_tool() {
  local work="$1" app="$2" name="$3" identity="$4" pods="$harness_root/apps/browser/macos/Pods/Sparkle"
  [ -d "$work/fw/Sparkle.framework" ] || ditto "$app/Contents/Frameworks/Sparkle.framework" "$work/fw/Sparkle.framework"
  swiftc -O "$harness_dir/$name.swift" -F "$pods" -framework Sparkle -Xlinker -rpath -Xlinker "$work/fw" \
    -o "$work/$name" 2>"$work/swiftc.log" || { cat "$work/swiftc.log" >&2; return 1; }
  codesign --force --timestamp=none --sign "$identity" "$work/$name" 2>/dev/null
}

retag() {
  local app="$1" bundle_id="$2" public_key="$3" identity="$4"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" -c "Set :SUPublicEDKey $public_key" "$app/Contents/Info.plist"
  codesign --force --deep --timestamp=none --sign "$identity" "$app" 2>/dev/null
}

free_port() {
  python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'
}

serve_dir() {
  local dir="$1" port_file
  port_file="$(mktemp "${TMPDIR:-/tmp}/ac-serve.XXXXXX")"
  python3 -c '
import functools, http.server, sys
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1]))
print(server.server_port, flush=True)
server.serve_forever()
' "$dir" >"$port_file" 2>/dev/null &
  server=$!
  served_port=""
  for _ in $(seq 1 100); do
    served_port="$(head -1 "$port_file")"
    [ -n "$served_port" ] && break
    kill -0 "$server" 2>/dev/null || break
    sleep 0.1
  done
  rm -f "$port_file"
  [ -n "$served_port" ] || { echo "error: couldn't serve $dir" >&2; return 1; }
}
