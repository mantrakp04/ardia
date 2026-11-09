import assert from "node:assert/strict";
import { test } from "node:test";
import { fixRelease, fixStatus, type Issue } from "./fix-status.ts";
import type { Release } from "./github.ts";
import { describeEvent, groupSessions, type TimelineEvent } from "./people-timeline.ts";

const MIN = 60_000;
const DAY = 86_400_000;

const event = (id: string, at: number, name: string, session = "", properties: Record<string, string> = {}): TimelineEvent => ({
  id,
  at,
  event: name,
  session,
  version: "0.2.45",
  properties,
  ...describeEvent(name, properties),
});

test("events with a session id group by it, older ones by 30-minute gaps and launches", () => {
  const sessions = groupSessions([
    event("a", 0, "app_launched"),
    event("b", 10 * MIN, "perf_journeys"),
    event("c", 45 * MIN, "app_session_ended"),
    event("d", 50 * MIN, "app_launched"),
    event("e", 55 * MIN, "page_process_gone"),
    event("f", 100 * MIN, "app_launched", "s1"),
    event("g", 300 * MIN, "$exception", "s1", { source: "native_crash" }),
  ]);
  assert.deepEqual(
    sessions.map((s) => s.events.map((e) => e.id)),
    [["g", "f"], ["e", "d"], ["c"], ["b", "a"]],
  );
  assert.equal(sessions[0]!.session, "s1");
  assert.equal(sessions[0]!.crashed, true);
  assert.equal(sessions[1]!.crashed, false);
});

const release = (version: string, published: string, prerelease: boolean): Release => ({
  tag: `v${version}`,
  version,
  name: version,
  published,
  prerelease,
  url: "",
  dmg: 0,
  zip: 0,
  appcast: 0,
  total: 0,
  assets: [],
});

const releases = [
  { ...release("engine-38b319abda74", "2026-11-02T12:00:00Z", true), tag: "engine-38b319abda74" },
  release("0.2.44", "2026-11-01T00:00:00Z", false),
  release("0.2.45-nightly.1", "2026-11-03T00:00:00Z", true),
  release("0.2.45-nightly.2", "2026-11-05T00:00:00Z", true),
  release("0.2.45", "2026-11-06T00:00:00Z", false),
];

const closed = (at: string, reason = "completed"): Issue => ({ number: 7, state: "closed", reason, closedAt: Date.parse(at), title: "", url: "" });

test("background activity keeps a session without an id together across quiet hours", () => {
  const events = [event("a", 0, "app_launched"), event("b", 70 * MIN, "perf_journeys"), event("c", 200 * MIN, "perf_journeys")];
  const beats = [5, 65, 125].map((m) => m * MIN);
  assert.deepEqual(
    groupSessions(events, beats).map((s) => s.events.map((e) => e.id)),
    [["c"], ["b", "a"]],
  );
});

test("the fix is the first release on the report's channel after the issue closed", () => {
  assert.equal(fixRelease(Date.parse("2026-11-02T00:00:00Z"), "nightly", releases)?.version, "0.2.45-nightly.1");
  assert.equal(fixRelease(Date.parse("2026-11-02T00:00:00Z"), "stable", releases)?.version, "0.2.45");
  assert.equal(fixRelease(Date.parse("2026-11-07T00:00:00Z"), "stable", releases), null);
});

test("status follows the issue, the fix release and the reporter's errors after it", () => {
  const at = Date.parse("2026-11-01T12:00:00Z");
  const report = { at, issueNumber: 7, channel: "nightly" };
  const crash = { at: at - 5 * MIN, version: "0.2.44", type: "EXC_BAD_ACCESS" };
  assert.equal(fixStatus({ ...report, issueNumber: null }, null, releases, undefined).state, "no-issue");
  assert.equal(fixStatus(report, { ...closed("2026-11-02T00:00:00Z"), state: "open" }, releases, undefined).state, "open");
  assert.equal(fixStatus(report, closed("2026-11-02T00:00:00Z", "not_planned"), releases, undefined).state, "not-planned");
  assert.equal(fixStatus(report, closed("2026-11-07T00:00:00Z"), releases, undefined).state, "unreleased");

  const fixed = fixStatus(report, closed("2026-11-02T00:00:00Z"), releases, { versions: ["0.2.44"], exceptions: [crash] });
  assert.deepEqual([fixed.state, fixed.label, fixed.errorTypes], ["fixed", "Fixed in 0.2.45-nightly.1", ["EXC_BAD_ACCESS"]]);

  const quiet = fixStatus(report, closed("2026-11-02T00:00:00Z"), releases, { versions: ["0.2.44", "0.2.45-nightly.2"], exceptions: [crash] });
  assert.deepEqual([quiet.state, quiet.label], ["not-seen", "Not seen since 0.2.45-nightly.1"]);

  const back = fixStatus(report, closed("2026-11-02T00:00:00Z"), releases, {
    versions: ["0.2.45-nightly.2"],
    exceptions: [crash, { at: at + 4 * DAY, version: "0.2.45-nightly.2", type: "EXC_BAD_ACCESS" }],
  });
  assert.equal(back.state, "came-back");

  const other = fixStatus(report, closed("2026-11-02T00:00:00Z"), releases, {
    versions: ["0.2.45-nightly.2"],
    exceptions: [crash, { at: at + 4 * DAY, version: "0.2.45-nightly.2", type: "TypeError" }],
  });
  assert.equal(other.state, "not-seen");
});
