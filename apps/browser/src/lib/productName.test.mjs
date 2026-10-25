import assert from "node:assert/strict";
import { test } from "node:test";
import { appInfo } from "@ardia/shell";

appInfo.appName = "Name";
appInfo.telemetryURL = "https://stats.example.com/otel/v1/logs";
appInfo.switchesURL = "https://stats.example.com/flags.json";
appInfo.updateFeedURL = "https://github.com/example/name/releases/latest/download/appcast.xml";

const { PRODUCT, SERVICES } = await import("./productName.ts");
const { ONBOARDING_COPY } = await import("../components/onboarding/copy.ts");
const { SETTINGS, setting } = await import("../components/settings/settingsIndex.ts");
const { SHARING_COPY } = await import("../telemetry/copy.ts");

test("the bundle's product name names the app everywhere", () => {
  assert.equal(PRODUCT, "Name");
  assert.equal(ONBOARDING_COPY.wordmark, "Name");
  assert.equal(ONBOARDING_COPY.system.setDefault, "Set Name as default browser");
  assert.equal(ONBOARDING_COPY.system.title, "Make Name your default?");
  assert.equal(ONBOARDING_COPY.links.little, "Little Name");
  assert.equal(setting("general.openAtLogin").title, "Open Name at login");
  assert.equal(setting("general.autoUpdate").title, "Automatically update Name");
  assert.equal(SHARING_COPY.ask.title, "Help fix Name?");
  assert.equal(SETTINGS.find((e) => e.id.endsWith(".cliControl")).title, "Let the name command control Name");
  assert.equal(SETTINGS.find((e) => e.id.endsWith(".cliInstall")).title, "The name command");
});

test("no product-facing copy still names Ardia", () => {
  const strings = [
    ONBOARDING_COPY.sourceSubtitle,
    ...Object.values(ONBOARDING_COPY.quit),
    ...Object.values(ONBOARDING_COPY.system),
    ...Object.values(ONBOARDING_COPY.links),
    ONBOARDING_COPY.pinnedSubtitle,
    ...SETTINGS.flatMap((e) => [e.title, e.section, e.description ?? ""]),
    JSON.stringify(SHARING_COPY),
  ];
  assert.deepEqual(strings.filter((s) => /Ardia/.test(s)), []);
});

test("sharing copy names the servers this build talks to", () => {
  assert.deepEqual(SERVICES, { telemetryHost: "stats.example.com", updateHost: "github.com", switchFile: "stats.example.com/flags.json" });
  assert.match(SHARING_COPY.footnote, /^Sent to stats\.example\.com /);
  assert.match(SHARING_COPY.switchFile, /reads stats\.example\.com\/flags\.json:/);
});

test("a fork opens its own pages under its scheme and still knows ardia:// ones", async () => {
  const { APP_SCHEME } = await import("./productName.ts");
  const { internalPageOf, internalUrl } = await import("../components/pages/internalUrls.ts");
  const { urlForDisplay } = await import("@ardia/core");
  assert.equal(APP_SCHEME, "name");
  assert.equal(internalUrl("history"), "name://history");
  assert.equal(internalUrl("history", "a b"), "name://history?q=a%20b");
  assert.equal(internalPageOf("name://history?q=x"), "history");
  assert.equal(internalPageOf("ardia://bookmarks"), "bookmarks");
  assert.equal(internalPageOf("NAME://Downloads/"), "downloads");
  assert.equal(internalPageOf("chrome://history"), null);
  assert.equal(internalPageOf("name://version"), null);
  assert.equal(internalPageOf("https://name.example/history"), null);
  assert.equal(urlForDisplay("chrome://version/"), "name://version");
});
