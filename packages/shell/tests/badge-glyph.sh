#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/ardia-badge-tests.XXXXXX")
trap 'rm -rf "$work"' EXIT
python3 - "$root" "$work" <<'PY'
import sys
from pathlib import Path
root, work = map(Path, sys.argv[1:])
stub = '''var testBackingScale: CGFloat = 2
class BadgeTestWindow: NSWindow {
  override var backingScaleFactor: CGFloat { testBackingScale }
}
let badgeTestWindow = BadgeTestWindow(contentRect: .zero, styleMask: [], backing: .buffered, defer: true)
class AppContext {}
class ExpoView: NSView {
  override var window: NSWindow? { badgeTestWindow }
  override var isFlipped: Bool { NSGraphicsContext.current?.isFlipped ?? false }
  required init(appContext: AppContext? = nil) { super.init(frame: .zero) }
  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }
}'''
source = (root / 'ios/BadgeGlyphView.swift').read_text().replace('import ExpoModulesCore', stub)
(work / 'main.swift').write_text(source + '\n' + (root / 'tests/BadgeGlyphTests.swift').read_text())
PY
swiftc -module-cache-path "$work/modules" "$work/main.swift" -o "$work/test"
"$work/test" "$@"
