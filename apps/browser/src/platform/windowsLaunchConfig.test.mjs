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

test("the launcher, which runs before the app's DLL, reads only ARDIA_BACKGROUND, and only to keep a failure quiet", () => {
  const launcher = readFileSync(new URL("../../windows/ArdiaLauncher/Launcher.cpp", import.meta.url), "utf8");
  const reads = launcher.match(ENVIRONMENT_READ) ?? [];
  assert.equal(reads.length, 1);
  assert.match(launcher, /DWORD length = GetEnvironmentVariableW\(L"ARDIA_BACKGROUND", value, 4\);/);
  assert.match(launcher, /if \(!Background\(\)\) MessageBoxW\(/);
  assert.equal(launcher.split("Background()").length - 1, 2);
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
  assert.match(gate, /RealFolderClash\(\{Paths::DataDirectory\(\), Paths::DataDirectory\(\) \/ L"Chromium", Paths::DataDirectory\(\) \/ L"Sync"\}, L"ARDIA_DATA_DIR"\)/);
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
  assert.match(script("launch-smoke.ps1"), /"Ardia\.test-build"\r?\nNew-Item -ItemType File -Force -Path \$testBuild/);
  assert.match(script("tour.ps1"), /exit 0\r?\n\}\r?\n\$App = \(Resolve-Path -LiteralPath \$App\)\.Path\r?\nNew-Item -ItemType File -Force -Path \(Join-Path \(Split-Path -Parent \$App\) "Ardia\.test-build"\)/);
  for (const packaging of ["make-installer.ps1", "installer-check.ps1"]) assert.match(script(packaging), /-Recurse -File -Force -Filter "Ardia\.test-build"/, packaging);
  assert.match(source("TestGate.h"), /constexpr wchar_t TestBuildMarker\[\] = L"Ardia\.test-build";/);
});

test("a test instance seals its sync key under its own DPAPI purpose, so it can't unseal or stand in for the real one", () => {
  const secrets = source("SyncSecrets.h");
  assert.match(secrets, /constexpr std::string_view TestInstancePurpose = "\/test-instance";/);
  assert.match(secrets, /std::string_view instance = testInstance \? TestInstancePurpose : std::string_view\{\};\n  return std::string\{KeyPurpose\} \+ std::string\{instance\} \+ "\/" \+ account;/);
  assert.match(secrets, /inline std::string Purpose\(std::string const &account\) \{ return PurposeFor\(account, AppLaunch::Shared\(\)\.testInstance\); \}/);
  assert.match(secrets, /bool apartFromOtherInstances = stored && !Unprotect\(\*stored, PurposeFor\(account, !AppLaunch::Shared\(\)\.testInstance\)\);/);
  assert.match(source("SyncModule.h"), /void selfTest\([^\n]*\n    if \(!AppLaunch::Shared\(\)\.testInstance\) return promise\.Reject/);
  assert.equal(secrets.split("CryptProtectData(").length - 1, 1);
  assert.equal(secrets.split("CryptUnprotectData(").length - 1, 1);
  assert.match(secrets, /std::string purpose = Purpose\(account\);\n[^\n]*\n    DATA_BLOB extra\{static_cast<DWORD>\(purpose\.size\(\)\)/);
});

test("an app folder the Windows workflow uploads has lost its test-build marker, with no harness run after that", () => {
  const workflow = readFileSync(new URL("../../../../.github/workflows/windows.yml", import.meta.url), "utf8");
  const jobs = workflow.split(/\r?\n  (?=[a-z0-9-]+:\r?\n    runs-on:)/).slice(1);
  assert.equal(jobs.length, 2);
  for (const job of jobs) {
    const strip = job.indexOf('-Filter "Ardia.test-build"');
    assert.ok(strip > 0, "the job removes the marker");
    const uploads = [...job.matchAll(/path: (\$\{\{ runner\.temp \}\}\/Ardia|apps\/browser\/windows\/\w+\/Release)\r?\n/g)];
    assert.equal(uploads.length, 2);
    const removal = job.slice(job.lastIndexOf("\n", strip), job.indexOf("\n", strip));
    for (const upload of uploads) {
      assert.ok(upload.index > strip, `${upload[1]} is uploaded after the marker is removed`);
      assert.ok(removal.includes(upload[1]), `${upload[1]} is one of the folders the marker is removed from`);
    }
    assert.doesNotMatch(job.slice(strip), /launch-smoke\.ps1|tour\.ps1/);
  }
});
