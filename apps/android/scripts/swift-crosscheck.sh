#!/bin/sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
scratch=${ARDIA_CROSSCHECK_DIR:-$(mktemp -d -t ardia-crosscheck)}
mkdir -p "$scratch"
swift build --package-path "$here/crosscheck" --scratch-path "$scratch/spm" -c release
tool=$(swift build --package-path "$here/crosscheck" --scratch-path "$scratch/spm" -c release --show-bin-path)/CrossCheck
"$tool" write "$scratch/swift-wrote"
"$here/../gradlew" -p "$here/.." --console=plain :sync:testDebugUnitTest --tests com.ardia.sync.core.SwiftCrossCheckTest \
  "-Dardia.crossCheck.swiftWrote=$scratch/swift-wrote" "-Dardia.crossCheck.kotlinWrites=$scratch/kotlin-wrote"
"$tool" read "$scratch/kotlin-wrote"
