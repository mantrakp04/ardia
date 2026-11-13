import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const { cleanProperties } = await import("./sanitize.ts");
const faults = await import("./webkitMediaFaults.ts");
after(() => client.setSharing(false, "settings"));

async function sentUsageCounts() {
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[]}');
  return saved.events.filter((e) => e.event === "usage_counts");
}

const faultKeys = (event) => Object.keys(event.properties).filter((key) => key.startsWith("webkit_fault"));

test("every reason is a distinct key the telemetry client keeps", () => {
  assert.equal(new Set(faults.MEDIA_FAULT_REASONS).size, faults.MEDIA_FAULT_REASONS.length);
  assert.equal(faults.MEDIA_FAULT_REASONS.length, 28);
  for (const reason of faults.MEDIA_FAULT_REASONS) {
    const props = Object.fromEntries([`webkit_fault_${reason}`, "webkit_faults_muted", "webkit_faults_blocker_active"].map((key) => [key, 1]));
    assert.deepEqual(Object.keys(cleanProperties(props)), Object.keys(props), reason);
  }
});

test("the reasons the app counts are the reasons the WebKit tab accepts", () => {
  const swift = readFileSync(new URL("../../../../../packages/ardiacore/ios/WebKitMediaFaults.swift", import.meta.url), "utf8");
  const set = swift.match(/static let reasons: Set<String> = \[([^\]]*)\]/);
  assert.ok(set);
  const swiftReasons = [...set[1].matchAll(/"([^"\n]*)"/g)].map((m) => m[1]);
  assert.deepEqual([...swiftReasons].sort(), [...faults.MEDIA_FAULT_REASONS].sort());
});

test("a fault is counted per reason with whether the tab was muted and the blocker was on, and taking the counts starts over", () => {
  assert.deepEqual(faults.takeWebKitMediaFaultCounts(), {});
  faults.noteWebKitMediaFault({ reason: "eme_widevine_refused_not_supported", muted: false, blockerActive: true });
  faults.noteWebKitMediaFault({ reason: "eme_widevine_refused_not_supported", muted: true, blockerActive: true });
  faults.noteWebKitMediaFault({ reason: "play_rejected_not_allowed", muted: false, blockerActive: false });
  faults.noteWebKitMediaFault({ reason: "media_error_decode" });
  assert.deepEqual(faults.takeWebKitMediaFaultCounts(), {
    webkit_fault_eme_widevine_refused_not_supported: 2,
    webkit_fault_media_error_decode: 1,
    webkit_fault_play_rejected_not_allowed: 1,
    webkit_faults_muted: 1,
    webkit_faults_blocker_active: 2,
  });
  assert.deepEqual(faults.takeWebKitMediaFaultCounts(), {});
});

test("a reason that isn't in the fixed set is ignored, whatever else the page sent", () => {
  faults.noteWebKitMediaFault({ reason: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT", muted: true, blockerActive: true });
  faults.noteWebKitMediaFault({ reason: "eme_widevine_refused_other_account_jane" });
  faults.noteWebKitMediaFault({ reason: 4 });
  faults.noteWebKitMediaFault({});
  faults.noteWebKitMediaFault(undefined);
  assert.deepEqual(faults.takeWebKitMediaFaultCounts(), {});
});

test("faults are sent once with usage_counts, never with a host or address, and start again from zero", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");
  const before = (await sentUsageCounts()).length;

  faults.noteWebKitMediaFault({ reason: "eme_widevine_refused_security", muted: false, blockerActive: true, host: "open.spotify.com", url: "https://open.spotify.com/track/1", title: "Song" });
  faults.noteWebKitMediaFault({ reason: "eme_widevine_refused_security", muted: true, blockerActive: true });
  faults.noteWebKitMediaFault({ reason: "play_rejected_not_supported", muted: false, blockerActive: false });
  usage.sessionEnding();

  const sent = await sentUsageCounts();
  assert.equal(sent.length, before + 1);
  const event = sent.at(-1);
  const props = Object.fromEntries(faultKeys(event).map((key) => [key, event.properties[key]]));
  assert.deepEqual(props, {
    webkit_fault_eme_widevine_refused_security: 2,
    webkit_fault_play_rejected_not_supported: 1,
    webkit_faults_muted: 1,
    webkit_faults_blocker_active: 2,
  });
  const text = JSON.stringify(event);
  for (const secret of ["spotify", "http", "track", "Song", "jane"]) assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `the event carries "${secret}"`);

  usage.sessionEnding();
  const later = (await sentUsageCounts()).slice(before + 1);
  assert.deepEqual(later.filter((e) => faultKeys(e).length), []);
});

test("Copy Diagnostics gets one line with the session's counts, which sending them does not reset", () => {
  assert.match(faults.webKitMediaFaultsLine(), /^WebKit media faults this session: /);
  assert.ok(!faults.webKitMediaFaultsLine().includes("\n"));
  assert.equal(
    faults.webKitMediaFaultsLine(),
    "WebKit media faults this session: eme_widevine_refused_not_supported 2, eme_widevine_refused_security 2, media_error_decode 1, play_rejected_not_allowed 1, play_rejected_not_supported 1, muted 2, blocker_active 4",
  );
});
