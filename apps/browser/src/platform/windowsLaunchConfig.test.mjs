import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const native = new URL("../../windows/Ardia/", import.meta.url);
const scripts = new URL("../../../../scripts/windows/", import.meta.url);
const ENVIRONMENT_READ = /\bGetEnvironmentVariable[AW]?\s*\(|\b_?w?getenv(?:_s)?\s*\(|\bPaths::Environment\s*\(|\bEnvironment\s*\(\s*L"/g;
const READERS = new Set(["Paths.h", "LaunchConfig.h"]);
const source = (name) => readFileSync(new URL(name, native), "utf8");

test("Windows native code reads the environment only in the launch config", () => {
  const files = readdirSync(native).filter((name) => /\.(?:h|cpp)$/.test(name));
  assert.ok(files.length > 20);
  const readers = files.filter((name) => (source(name).match(ENVIRONMENT_READ) ?? []).length > 0).sort();
  assert.deepEqual(readers, [...READERS].sort());
});

test("only LaunchConfig.h reads ARDIA_TEST, ARDIA_TRACE, ARDIA_CONFIG_DIR and ARDIA_INSTANCE, and a non-test instance drops them", () => {
  for (const variable of ["ARDIA_TEST", "ARDIA_TRACE", "ARDIA_CONFIG_DIR", "ARDIA_INSTANCE", "ARDIA_BACKGROUND"]) {
    const reading = readdirSync(native).filter((name) => /\.(?:h|cpp)$/.test(name) && source(name).includes(`L"${variable}"`));
    assert.deepEqual(reading, ["LaunchConfig.h"], variable);
  }
  const config = source("LaunchConfig.h");
  assert.match(config, /config\.testInstance = refusal\.empty\(\);/);
  assert.match(config, /if \(config\.testInstance\) return config;[\s\S]*config\.trace\.clear\(\);\n  config\.test\.clear\(\);/);
  assert.match(config, /TestOnlyInstanceKeys\(\) noexcept \{\n  static const std::vector<std::string_view> keys\{"updateFeed", "importSourceDir", "importSafariHome"\};/);
  assert.match(config, /std::wstring chosen = testInstance \? Paths::Environment\(L"ARDIA_CONFIG_DIR"\) : std::wstring\{\};/);
});

test("a test instance needs an absolute scratch folder clear of the real profile and a test build", () => {
  const gate = source("TestGate.h");
  assert.match(gate, /if \(!requested\.is_absolute\(\)\) return/);
  assert.match(gate, /FOLDERID_LocalAppData, L"LOCALAPPDATA"\) \/ L"Ardia"/);
  assert.match(gate, /FOLDERID_RoamingAppData, L"APPDATA"\) \/ L"Ardia"/);
  assert.match(gate, /RealFolderClash\(\{Paths::DataDirectory\(\), Paths::DataDirectory\(\) \/ L"Chromium"\}, L"ARDIA_DATA_DIR"\)/);
  assert.match(source("LaunchConfig.h"), /TestGate::RealFolderClash\(\{requested\}, L"ARDIA_CONFIG_DIR"\);\n    if \(clash\.empty\(\)\) return Paths::Ensured\(requested\);/);
  assert.match(gate, /VOLUME_NAME_GUID \| FILE_NAME_NORMALIZED/);
  assert.match(gate, /if \(!TestBuild\(\)\) return/);
});

test("the test-build marker never reaches an installer, and the harnesses that need test keys write it", () => {
  const script = (name) => readFileSync(new URL(name, scripts), "utf8");
  assert.match(script("assemble.ps1"), /if \(\$relative -ieq "Ardia\.test-build"\) \{ continue \}/);
  assert.match(script("make-installer.ps1"), /-Filter "Ardia\.test-build"[^\n]*throw/);
  assert.match(script("installer-check.ps1"), /-Filter "Ardia\.test-build"[^\n]*throw/);
  const smoke = script("launch-smoke.ps1");
  for (const kind of ["no test-build marker", "a relative ARDIA_DATA_DIR", "the real profile folder", "a junction to the real profile folder"]) assert.ok(smoke.includes(`"${kind}"`), kind);
  for (const harness of ["launch-smoke.ps1", "tour.ps1"]) assert.match(script(harness), /"Ardia\.test-build"\r?\nNew-Item -ItemType File -Force -Path \$testBuild/, harness);
  assert.match(source("TestGate.h"), /constexpr wchar_t TestBuildMarker\[\] = L"Ardia\.test-build";/);
});
