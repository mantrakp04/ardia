import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
globalThis.acTestNativeModules = {};

const { useBrowser } = await import("../browser/store.ts");
const { emptyScope, canonical } = await import("@ardia/sync");
const themes = await import("./syncThemes.ts");
const nightlyFour = await import("./fixtures/syncThemes-v0.2.43-nightly.4.ts");
const S = () => useBrowser.getState();

const THEME = { stops: [{ x: 0.5, y: 0.5, color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } }], intensity: 0.6, mode: "auto", grain: 0.2, texture: "grain", translucency: 1 };
const KEY = "pth:s1";
const at = (v) => ({ h: "000000009.0000.peer", v, o: ["peer", 1] });

const RECORDS = {
  absent: () => ({}),
  tombstone: (app) => (app.records[KEY] = at(null)),
  unapplied: (app) => (app.records[KEY] = at({ t: THEME })),
  applied: (app) => ((app.records[KEY] = at({ t: THEME })), (app.base[KEY] = canonical({ t: THEME }))),
  unreadable: (app) => ((app.records[KEY] = at({ t: "from a newer version" })), (app.base[KEY] = canonical({ t: "from a newer version" }))),
};
const PULLS = {
  clean: () => {},
  pending: (app) => ((app.pending = 1), (app.pendingSince = { f9: Date.now() })),
  damaged: (app) => (app.damaged = { f9: Date.now() }),
  setAside: (app) => (app.files = { f9: { d: "", k: "bad", at: Date.now() } }),
};

const settleNow = themes.settleThemeAdoption;
const settleThen = (profiles, app, afterPull) => (afterPull ? nightlyFour.confirmThemes(profiles, app) : nightlyFour.settleAppliedThemes(profiles, app));

function scope(record, pull) {
  const app = emptyScope();
  RECORDS[record](app);
  PULLS[pull](app);
  return app;
}

test("this build ends a stored adoption exactly where v0.2.43-nightly.4 does, at load and after a pull", () => {
  for (const record of Object.keys(RECORDS)) {
    for (const pull of Object.keys(PULLS)) {
      for (const afterPull of [false, true]) {
        const now = { default: { syncId: "s1", enabled: true, themeAdopting: true } };
        const then = structuredClone(now);
        settleNow(now, scope(record, pull), afterPull);
        settleThen(then, scope(record, pull), afterPull);
        assert.equal(now.default.themeAdopting, then.default.themeAdopting, `${record} record, ${pull} pull, ${afterPull ? "after a pull" : "at load"}`);
      }
    }
  }
});

test("a pairing made here hands nightly.4 a flag it ends where it would its own, and back", () => {
  S().hydrate({});
  const app = scope("absent", "pending");
  const link = { syncId: "s1", enabled: true };
  themes.pairTheme(app, "default", link);
  assert.equal(link.themeAdopting, true, "pairing while the theme downloads adopts");
  const saved = JSON.parse(JSON.stringify({ default: link }));
  nightlyFour.confirmThemes(saved, app);
  assert.equal(saved.default.themeAdopting, true, "nightly.4 keeps waiting while the download is pending");
  RECORDS.applied(app);
  app.pending = 0;
  delete app.pendingSince;
  nightlyFour.confirmThemes(saved, app);
  assert.equal(saved.default.themeAdopting, undefined, "and ends it once the theme is applied");
  const back = JSON.parse(JSON.stringify(saved));
  settleNow(back, app, false);
  assert.equal(back.default.themeAdopting, undefined, "this build reads that as adopted");

  const paired = { syncId: "s1", enabled: true };
  themes.pairTheme(app, "default", paired);
  assert.equal(paired.themeAdopting, undefined, "pairing against a theme already there adopts at once, as nightly.4 did");
});
