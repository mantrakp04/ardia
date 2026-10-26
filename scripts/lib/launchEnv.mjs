import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

const list = (entries) =>
  Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => (value === true ? key : `${key}=${value}`))
    .join(",");

export function launchVariables({ instance = {}, test = {}, trace = [], switchOverrides = {} } = {}) {
  const env = {};
  const instanceList = list(instance);
  const testList = list(test);
  const switchList = Object.entries(switchOverrides).map(([name, on]) => `${name}=${on ? "on" : "off"}`).join(",");
  if (instanceList) env.ARDIA_INSTANCE = instanceList;
  if (testList) env.ARDIA_TEST = testList;
  if (trace.length) env.ARDIA_TRACE = trace.join(",");
  if (switchList) env.ARDIA_SWITCHES = switchList;
  return env;
}

const OLD_INSTANCE = {
  jsLocation: "ARDIA_JS_LOCATION", chromiumSwitches: "ARDIA_CHROMIUM_SWITCHES", downloadsDir: "ARDIA_DOWNLOADS_DIR",
  updateFeed: "ARDIA_UPDATE_FEED_URL", allowAudio: "ARDIA_ALLOW_AUDIO", allowOcclusion: "ARDIA_ALLOW_OCCLUSION",
  releaseNotes: "ARDIA_RELEASE_NOTES", cliHome: "ARDIA_CLI_HOME", cliBinDir: "ARDIA_CLI_BIN_DIR", cliUrl: "ARDIA_CLI_URL",
  syncFolder: "ARDIA_SYNC_DEFAULT_FOLDER", importSourceDir: "ARDIA_IMPORT_SOURCE_DIR", importSafariHome: "ARDIA_IMPORT_SAFARI_HOME",
};
const OLD_TEST = {
  keychain: "ARDIA_TEST_KEYCHAIN", keychainHiddenReads: "ARDIA_TEST_KEYCHAIN_HIDDEN_READS", keychainFail: "ARDIA_TEST_KEYCHAIN_FAIL",
  safeStorageAnswer: "ARDIA_TEST_SAFE_STORAGE_ANSWER", reauth: "ARDIA_TEST_REAUTH", pipSelfTest: "ARDIA_PIP_SELFTEST",
  pipHover: "ARDIA_PIP_HOVER", fakeFullScreenMs: "ARDIA_FAKE_FULLSCREEN_MS", shadersKeyWindow: "ARDIA_SHADERS_FORCE_KEY",
  peekStrict: "ARDIA_PEEK_STRICT", importSecret: "ARDIA_IMPORT_TEST_SECRET", importDiaBundleId: "ARDIA_IMPORT_DIA_BUNDLE_ID",
  cliInstallScript: "ARDIA_CLI_INSTALL_SCRIPT", legacySource: "ARDIA_LEGACY_SOURCE", legacyCrashAfter: "ARDIA_LEGACY_CRASH_AFTER",
  bangsUrl: "ARDIA_BANGS_URL", onboarding: "ARDIA_ONBOARDING", whatsNew: "ARDIA_WHATS_NEW", telemetry: "ARDIA_TELEMETRY",
  liveMock: "ARDIA_LIVE_MOCK", calendarFixture: "ARDIA_CALENDAR_FIXTURE",
};
const OLD_TEST_SWITCH = {
  bluetoothChooser: "--ardia-test-bluetooth-chooser", externalProtocolNoLaunch: "--ardia-test-external-protocol-no-launch",
  mediaRouteProvider: "--ardia-test-media-route-provider", systemMediaPermission: "--ardia-test-system-media-permission",
  applyProfileGate: "--ardia-apply-profile-gate",
};
const OLD_TRACE = { visibility: "ARDIA_TRACE_VISIBILITY", pip: "ARDIA_TRACE_PIP", pipZoom: "ARDIA_PIP_ZOOM_TRACE" };

const knownKeys = { instance: Object.keys(OLD_INSTANCE), test: [...Object.keys(OLD_TEST), ...Object.keys(OLD_TEST_SWITCH), "contextMenu"] };
const commaKeys = new Set(["chromiumSwitches", "downloadsDir", "updateFeed", "cliHome", "cliBinDir", "cliUrl", "syncFolder",
  "importSourceDir", "importSafariHome", "importSecret", "cliInstallScript", "legacySource", "bangsUrl", "liveMock"]);

export const instanceEntries = (text) => entriesOf(text, knownKeys.instance);

const LIST_VARIABLES = new Set(["ARDIA_INSTANCE", "ARDIA_TEST", "ARDIA_TRACE", "ARDIA_SWITCHES"]);

export function mergeLaunchEnv(...envs) {
  const out = {};
  const instance = {}, test = {}, switches = {};
  const trace = new Set();
  for (const env of envs) {
    for (const [name, value] of Object.entries(env ?? {})) {
      if (!LIST_VARIABLES.has(name) || value === null || value === undefined) {
        out[name] = value;
        continue;
      }
      if (name === "ARDIA_INSTANCE") Object.assign(instance, entriesOf(value, knownKeys.instance));
      else if (name === "ARDIA_TEST") Object.assign(test, entriesOf(value, knownKeys.test));
      else if (name === "ARDIA_TRACE") for (const area of value.split(",").map((a) => a.trim()).filter(Boolean)) trace.add(area);
      else
        for (const piece of value.split(",")) {
          const [switchName, on] = piece.split("=").map((s) => s.trim());
          if (switchName && on) switches[switchName] = ["on", "1", "true"].includes(on);
        }
    }
  }
  const bare = (entries) => Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, value === "1" ? true : value]));
  return { ...out, ...launchVariables({ instance: bare(instance), test: bare(test), trace: [...trace], switchOverrides: switches }) };
}

function entriesOf(text, known) {
  const entries = {};
  let last = null;
  for (const piece of (text ?? "").split(",")) {
    const key = piece.split("=")[0].trim();
    if (!known.includes(key) && commaKeys.has(last)) {
      entries[last] += `,${piece}`;
      continue;
    }
    const at = piece.indexOf("=");
    if (key) entries[key] = at < 0 ? "1" : piece.slice(at + 1).trim();
    last = key;
  }
  return entries;
}

const readsLaunchConfig = new Map();
function binaryReadsLaunchConfig(binary) {
  const debugDylib = `${binary}.debug.dylib`;
  if (existsSync(debugDylib)) binary = debugDylib;
  if (readsLaunchConfig.has(binary)) return readsLaunchConfig.get(binary);
  const needle = Buffer.from("ARDIA_INSTANCE");
  const fd = openSync(binary, "r");
  const chunk = Buffer.alloc(1 << 22);
  let found = false;
  try {
    const size = statSync(binary).size;
    for (let at = 0; at < size && !found; at += chunk.length - needle.length) {
      const read = readSync(fd, chunk, 0, chunk.length, at);
      found = chunk.subarray(0, read).includes(needle);
    }
  } finally {
    closeSync(fd);
  }
  readsLaunchConfig.set(binary, found);
  return found;
}

export function forBuild(binary, env) {
  if (binaryReadsLaunchConfig(binary)) return env;
  const { ARDIA_INSTANCE, ARDIA_TEST, ARDIA_TRACE, ...rest } = env;
  const instance = entriesOf(ARDIA_INSTANCE, knownKeys.instance);
  const test = entriesOf(ARDIA_TEST, knownKeys.test);
  const out = { ...rest };
  for (const [key, value] of Object.entries(instance)) if (OLD_INSTANCE[key]) out[OLD_INSTANCE[key]] = value;
  for (const [key, value] of Object.entries(test)) if (OLD_TEST[key]) out[OLD_TEST[key]] = value;
  const switches = Object.entries(test).filter(([key]) => OLD_TEST_SWITCH[key])
    .map(([key, value]) => (value === "1" ? OLD_TEST_SWITCH[key] : `${OLD_TEST_SWITCH[key]}=${value}`));
  const data = env.ARDIA_DATA_DIR;
  if (test.contextMenu && data) out.ARDIA_CONTEXT_MENU_LOG = `${data}/context-menu.json`;
  for (const area of (ARDIA_TRACE ?? "").split(",").filter(Boolean)) {
    if (OLD_TRACE[area]) out[OLD_TRACE[area]] = "1";
    if (area === "trafficLights" && data) out.ARDIA_TRAFFIC_LIGHTS_LOG = `${data}/traffic-lights.log`;
    if (area === "profileGate") switches.push("--ardia-show-profile-gate");
  }
  if (switches.length) out.ARDIA_CHROMIUM_SWITCHES = [out.ARDIA_CHROMIUM_SWITCHES, ...switches].filter(Boolean).join(" ");
  return out;
}
