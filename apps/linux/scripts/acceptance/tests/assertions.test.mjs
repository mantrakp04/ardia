import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifySitePanel, downloadById, duplicateIds, findVerdict, launchLockHolders, launchStepsComplete, nextActive, percentText, privateLeaks, securityVerdict, visibleUnsupported, zoomAgreement } from "../lib/assertions.mjs";
import { parseArgs, UsageError } from "../lib/cli.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { sidebarDropPoint } from "../lib/ui.mjs";

const panel = (...rows) => ["Site Controls", ...rows, "Zoom: 100%"].join("\n");

describe("site panel security", () => {
  it("classifies each connection row", () => {
    assert.equal(classifySitePanel(panel("Connection is secure", "Certificate issued by Ardia Acceptance Test CA")).level, "secure");
    assert.equal(classifySitePanel(panel("Connection is not secure", "Don't enter sensitive information on this site.")).level, "insecure");
    assert.equal(classifySitePanel(panel("Connection is not secure", "Parts of this page aren't secure (such as images).")).level, "mixed");
    assert.equal(classifySitePanel(panel("Connection is not secure", "The site's certificate isn't valid. Don't enter passwords or payment details.")).level, "certificateError");
    assert.equal(classifySitePanel(panel("This is a local or internal page")).level, "local");
    assert.equal(classifySitePanel(panel("Connection information unavailable")).level, "unavailable");
    assert.equal(classifySitePanel("Site Controls").level, null);
  });

  it("never accepts a web page shown as local", () => {
    assert.deepEqual(securityVerdict("secure", panel("Connection is secure")).problems, []);
    assert.deepEqual(securityVerdict("insecure", panel("Local Page", "This is a local or internal page")).problems, ["expected insecure, saw local", "a web page was described as a local page"]);
    assert.deepEqual(securityVerdict("mixed", panel("Connection information unavailable")).problems, ["expected mixed, saw unavailable"]);
    assert.ok(securityVerdict("internal", panel("Local Page", "This is a local or internal page")).ok);
    assert.deepEqual(securityVerdict("secure", "nothing").problems, ["the site panel showed no connection row"]);
  });
});

describe("find, zoom and downloads", () => {
  it("checks counts and wraps next/previous", () => {
    assert.ok(findVerdict({ count: 3, active: 1 }, 3).ok);
    assert.match(findVerdict({ count: 5, active: 1 }, 3).problem, /expected 3 matches, saw 5/);
    assert.match(findVerdict({ count: 3, active: 0 }, 3).problem, /outside/);
    assert.deepEqual([nextActive(1, 3, true), nextActive(3, 3, true), nextActive(1, 3, false), nextActive(2, 3, false)], [2, 1, 3, 1]);
  });

  it("compares store zoom against native page scale", () => {
    assert.ok(zoomAgreement({ storeZoom: 1.1, pageRatio: 1.1 }).ok);
    assert.ok(zoomAgreement({ storeZoom: 1.25, pageRatio: 2.5, baseRatio: 2 }).ok);
    assert.match(zoomAgreement({ storeZoom: 1.1, pageRatio: 1 }).problem, /page scale 1.000/);
    assert.equal(percentText(1.1), "110%");
  });

  it("finds duplicates and entries by id", () => {
    assert.deepEqual(duplicateIds([{ id: "a" }, { id: "b" }, { id: "a" }]), ["a"]);
    assert.equal(downloadById([{ id: "a", state: "finished" }], "a").state, "finished");
    assert.equal(downloadById(undefined, "a"), null);
  });
});

describe("profiles and services", () => {
  it("detects every way private state can reach the saved session", () => {
    const seed = sessionSeed();
    assert.deepEqual(privateLeaks(seed), []);
    seed.windows.p = { id: "p", profileId: "incognito:p@default", incognito: true, originalProfileId: "default" };
    seed.tabs.pt = { id: "pt", profileId: "incognito:p@default" };
    seed.profileOrder.push("incognito:p@default");
    seed.parkedPins = { "incognito:p@default": {} };
    seed.ui = { lastProfileId: "incognito:p@default" };
    assert.deepEqual(privateLeaks(seed), ["window p", "tab pt", "parkedPins.incognito:p@default", "profileOrder incognito:p@default", "lastProfileId"]);
  });

  it("reads launch lease holders from a recorded navigator.locks.query()", () => {
    const recorded = { held: [{ name: "ardia.linux.app-launch", mode: "exclusive", clientId: "c1" }, { name: "other", mode: "exclusive", clientId: "c2" }], pending: [] };
    assert.deepEqual(launchLockHolders(recorded), ["c1"]);
    assert.deepEqual(launchLockHolders({ held: [], pending: [] }), []);
  });

  it("matches whole setting rows only", () => {
    const texts = { General: "General\nDefault browser\nWarn before quitting", Appearance: "Theme", Advanced: "The ardia command line is unavailable" };
    assert.deepEqual(visibleUnsupported(texts), ["general.defaultBrowser"]);
    assert.deepEqual(visibleUnsupported({ General: "General", Appearance: "", Advanced: "" }), []);
  });

  it("seeds a restorable session with one tab per URL", () => {
    const seed = sessionSeed({ windows: [{ id: "a", urls: ["http://x/", "http://y/"] }, { id: "b", urls: [""] }] });
    assert.deepEqual(seed.windowOrder, ["a", "b"]);
    assert.deepEqual(seed.windows.a.tabIds, ["a-tab-0", "a-tab-1"]);
    assert.equal(seed.windows.a.activeTabIds.default, "a-tab-1");
    assert.equal(seed.settings.restoreSession, true);
    assert.equal(seed.focusedWindowId, "a");
  });
});

describe("drop geometry", () => {
  it("picks the tallest drop area in the left third", () => {
    const areas = [{ left: 0, top: 0, width: 1280, height: 800 }, { left: 0, top: 40, width: 240, height: 700 }, { left: 0, top: 0, width: 240, height: 40 }, { left: 900, top: 0, width: 300, height: 800 }];
    assert.deepEqual(sidebarDropPoint(areas, 1280), { x: 120, y: 40 + 700 * 0.75, area: areas[1] });
    assert.equal(sidebarDropPoint([{ left: 900, top: 0, width: 300, height: 800 }], 1280), null);
  });
});

describe("command line", () => {
  it("resolves paths against the caller's directory and drops pnpm's separator", () => {
    const options = parseArgs(["--", "out/ardia", "dist", "--only", "F01,#33", "--keep", "--results=r"], { cwd: "/work" });
    assert.equal(options.executable, "/work/out/ardia");
    assert.equal(options.uiDir, "/work/dist");
    assert.deepEqual(options.only, ["F01", "#33"]);
    assert.equal(options.keep, true);
    assert.equal(options.results, "/work/r");
  });

  it("rejects missing executables, unknown flags and extra arguments", () => {
    assert.throws(() => parseArgs([], { cwd: "/" }), UsageError);
    assert.throws(() => parseArgs(["/x", "--bogus"], { cwd: "/" }), /Unknown option --bogus/);
    assert.throws(() => parseArgs(["/x", "/y", "/z"], { cwd: "/" }), /Unexpected argument/);
    assert.throws(() => parseArgs(["/x", "--only"], { cwd: "/" }), /--only needs/);
    assert.equal(parseArgs(["--list"], { cwd: "/" }).list, true);
  });
});

describe("launch steps", () => {
  it("count as complete only when all four are recorded", () => {
    assert.equal(launchStepsComplete(["version", "versionUpdated", "onboarding", "releaseNotes", "defaultBrowserOffer"]), true);
    assert.equal(launchStepsComplete(["version", "onboarding", "releaseNotes", "defaultBrowserOffer"]), true);
    assert.equal(launchStepsComplete(["version", "onboarding", "releaseNotes"]), false);
    assert.equal(launchStepsComplete(null), false);
  });
});
