import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { calendarFixture, startFakeEds } from "../lib/calendarFixtures.mjs";
import { events, ianaZone, occurrences, parseIcs } from "../../../src/calendarIcs.ts";

const dirs = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const hasDbus = await access("/usr/bin/dbus-daemon").then(() => true, () => false);
const hasGio = await new Promise((resolve) => {
  import("node:child_process").then(({ spawn }) => {
    const child = spawn("python3", ["-I", "-c", "import gi; gi.require_version('Gio', '2.0')"], { stdio: "ignore" });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
});

describe("F14 calendar fixtures", () => {
  it("expand to the instants the scenario expects", () => {
    const now = Date.UTC(2026, 9, 28, 15, 7, 30);
    const fixture = calendarFixture(now);
    const objects = events(fixture.config.objects["acceptance-work"].flatMap((text) => parseIcs(text)));
    const found = occurrences(objects, now - 12 * 3600000, now + 12 * 3600000, (tzid) => ianaZone(tzid));
    const at = (uid) => found.filter((o) => o.event.properties.find((p) => p.name === "UID")?.value === uid).map((o) => o.start);
    assert.deepEqual(at("acceptance-daily"), [fixture.expected.recurringToday]);
    assert.deepEqual(at("acceptance-standup"), [fixture.expected.standup]);
    assert.ok(fixture.expected.standup - now > 20000 && fixture.expected.standup - now <= 80000);
    assert.equal(fixture.config.sources.filter((s) => s.data.includes("[Calendar]")).length, 2);
  });

  it("serve a controllable fake Evolution Data Server on a private bus", { skip: !hasDbus || !hasGio }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "ardia-f14-"));
    dirs.push(dir);
    const fixture = calendarFixture();
    const eds = await startFakeEds(dir, fixture.config);
    try {
      assert.match(eds.address, /^unix:path=/);
      assert.deepEqual(await eds.control("Calls"), []);
      assert.equal(await eds.control("ReplaceObjects", "acceptance-work", JSON.stringify([fixture.added("x", Date.now())])), null);
      await eds.stopService();
    } finally {
      await eds.stop();
    }
  });
});
