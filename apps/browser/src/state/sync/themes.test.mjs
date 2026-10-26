import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { useBrowser } = await import("../browser/store.ts");
const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
const adapters = await import("./profileAdapters.ts");

const S = () => useBrowser.getState();
const LINKS = () => ({ default: { syncId: "s1" } });

const THEME = {
  stops: [
    { x: 0.2, y: 0.3, color: { r: 0.3, g: 0.75, b: 0.45, a: 1 } },
    { x: 0.8, y: 0.7, color: { r: 0.85, g: 0.3, b: 0.65, a: 1 } },
  ],
  intensity: 0.8,
  mode: "auto",
  grain: 0.4,
  texture: "grain",
  translucency: 1,
};

function profilesAdapterV0238(links) {
  const linked = () => Object.entries(links()).filter(([id]) => S().profiles[id]);
  return {
    prefix: "prof:",
    adoptRemoteOnJoin: true,
    extract: () => {
      const values = new Map();
      for (const [id, { syncId }] of linked()) {
        const p = S().profiles[id];
        values.set(`prof:${syncId}`, { n: p.name, c: p.color, i: p.icon, ...(id === "default" ? { d: true } : {}) });
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed) => {
      for (const [id, { syncId }] of linked()) {
        const record = visible.get(`prof:${syncId}`);
        if (!record || !changed.has(`prof:${syncId}`)) continue;
        S().updateProfile(id, { name: record.n, color: record.c, icon: record.i });
      }
    },
  };
}

class Folder {
  files = new Map();
  downloading = new Set();
  counter = 0;
  transport() {
    return {
      write: async (scope, payload) => {
        const id = `f${++this.counter}`;
        this.files.set(id, { scope, payload });
        return id;
      },
      read: async (scope, known) => {
        const here = [...this.files].filter(([id, f]) => f.scope === scope && !this.downloading.has(id));
        const files = here.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
        return { files, pending: [...this.downloading], damaged: [], present: here.map(([id]) => id) };
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
}

class Mac {
  constructor(id, folder, { legacy = false, joining = false } = {}) {
    this.id = id;
    this.folder = folder;
    S().hydrate({});
    this.browser = S();
    this.scope = emptyScope();
    this.scope.joined = !joining;
    this.clock = new Clock(id);
    this.adapters = legacy ? [profilesAdapterV0238(LINKS)] : [adapters.profilesAdapter(LINKS), adapters.profileThemesAdapter(LINKS, () => this.scope.records)];
  }
  with(fn) {
    useBrowser.setState(this.browser, true);
    try {
      return fn();
    } finally {
      this.browser = S();
    }
  }
  async sync() {
    useBrowser.setState(this.browser, true);
    try {
      const result = await syncScope({
        scope: "app",
        state: this.scope,
        transport: this.folder.transport(),
        adapters: this.adapters,
        clock: this.clock,
        device: this.id,
      });
      return result.published;
    } finally {
      this.browser = S();
    }
  }
  profile() {
    return this.browser.profiles.default;
  }
}

async function rounds(macs, n) {
  let published = 0;
  for (let i = 0; i < n; i++) for (const mac of macs) published += await mac.sync();
  return published;
}

test("a Mac on 0.2.38 and a Mac with a custom theme settle instead of republishing the profile forever", async () => {
  const folder = new Folder();
  const fresh = new Mac("new", folder);
  fresh.with(() => S().updateProfile("default", { color: "green", theme: THEME }));
  await fresh.sync();
  const old = new Mac("old", folder, { legacy: true, joining: true });
  await rounds([fresh, old], 3);
  assert.equal(await rounds([fresh, old], 4), 0, "nothing is published once both Macs have synced");
  assert.deepEqual(fresh.profile().theme, THEME);
  assert.equal(old.profile().color, "green", "the older Mac keeps the preset colour");
  assert.equal(old.profile().theme, undefined);

  old.with(() => S().updateProfile("default", { name: "Home" }));
  await rounds([fresh, old], 3);
  assert.equal(fresh.profile().name, "Home");
  assert.deepEqual(fresh.profile().theme, THEME, "a rename on the older Mac leaves the theme alone");
  assert.equal(await rounds([fresh, old], 4), 0, "and they settle again");
});

test("a rename on one Mac doesn't undo going back to a preset on another", async () => {
  const folder = new Folder();
  const a = new Mac("a", folder);
  a.with(() => S().updateProfile("default", { theme: THEME }));
  await a.sync();
  const b = new Mac("b", folder, { joining: true });
  await rounds([a, b], 3);
  assert.deepEqual(b.profile().theme, THEME);

  a.with(() => S().updateProfile("default", { theme: null }));
  b.with(() => S().updateProfile("default", { name: "Work" }));
  await a.sync();
  await b.sync();
  await rounds([a, b], 3);
  for (const mac of [a, b]) {
    assert.equal(mac.profile().theme, null, `${mac.id} keeps the preset`);
    assert.equal(mac.profile().name, "Work", `${mac.id} has the rename`);
  }
  assert.equal(await rounds([a, b], 4), 0);
});

test("a theme in a prof: record from a development build is adopted once and not written back there", async () => {
  const folder = new Folder();
  const dev = new Mac("dev", folder, { legacy: true });
  dev.adapters = [
    {
      ...profilesAdapterV0238(LINKS),
      extract: () => ({ values: new Map([["prof:s1", { n: "Personal", c: "plum", i: null, d: true, th: THEME }]]) }),
    },
  ];
  await dev.sync();
  const fresh = new Mac("new", folder, { joining: true });
  await rounds([fresh], 2);
  assert.deepEqual(fresh.profile().theme, THEME);
  const prof = fresh.scope.records["prof:s1"].v;
  assert.ok(!("th" in prof) || prof.o !== "new");
  assert.ok(fresh.scope.records["pth:s1"], "the theme is published as its own record");
});

test("a malformed theme record is ignored", () => {
  assert.equal(adapters.themeFromRecord({ t: { stops: "no" } }), null);
  assert.equal(adapters.themeFromRecord(null), null);
  assert.deepEqual(adapters.themeFromRecord({ preset: true }), { theme: null });
});

for (const [label, newer, expected] of [
  ["a newer theme", { t: THEME }, THEME],
  ["a reset to the preset", { preset: true }, null],
]) {
  test(`a legacy th and ${label} in the same pull: the pth: record wins`, async () => {
    const folder = new Folder();
    const dev = new Mac("dev", folder, { legacy: true });
    const older = { ...THEME, intensity: 0.2 };
    dev.adapters = [
      { ...profilesAdapterV0238(LINKS), extract: () => ({ values: new Map([["prof:s1", { n: "Personal", c: "plum", i: null, d: true, th: older }]]) }) },
      { prefix: "pth:", extract: () => ({ values: new Map([["pth:s1", newer]]) }), apply: () => {} },
    ];
    await dev.sync();
    const fresh = new Mac("new", folder, { joining: true });
    await rounds([fresh], 3);
    assert.deepEqual(fresh.profile().theme, expected);
    const pth = Object.entries(fresh.scope.records).filter(([k]) => k === "pth:s1").map(([, r]) => r.v);
    assert.deepEqual(pth, [newer], "nothing older is published over it");
  });
}

test("a legacy th arriving after a pth: record never publishes the older theme over it", async () => {
  const folder = new Folder();
  const newer = { ...THEME, intensity: 0.9 };
  const older = { ...THEME, intensity: 0.2 };
  const dev = new Mac("dev", folder, { legacy: true });
  let devTheme = null;
  dev.adapters = [
    { ...profilesAdapterV0238(LINKS), extract: () => ({ values: new Map([["prof:s1", { n: "Personal", c: "plum", i: null, d: true, ...(devTheme ? { th: devTheme } : {}) }]]) }) },
    { prefix: "pth:", extract: () => ({ values: new Map([["pth:s1", { t: newer }]]) }), apply: () => {} },
  ];
  await dev.sync();
  let links = {};
  const fresh = new Mac("new", folder, { joining: true });
  fresh.adapters = [adapters.profilesAdapter(() => links), adapters.profileThemesAdapter(() => links, () => fresh.scope.records)];
  await fresh.sync();
  links = LINKS();
  devTheme = older;
  await dev.sync();
  await rounds([fresh], 3);
  assert.notDeepEqual(fresh.profile().theme, older, "the legacy th doesn't replace a known pth:");
  assert.deepEqual(fresh.scope.records["pth:s1"].v, { t: newer }, "nothing older is published over it");
});

test("a joining Mac with its own theme waits for a pth: file still downloading instead of publishing over it", async () => {
  const folder = new Folder();
  const first = new Mac("first", folder);
  first.with(() => S().updateProfile("default", { theme: THEME }));
  await first.sync();
  const themeFile = `f${folder.counter}`;
  first.with(() => S().updateProfile("default", { name: "Home" }));
  await first.sync();
  folder.downloading.add(themeFile);

  const own = { ...THEME, intensity: 0.15, stops: [THEME.stops[1]] };
  const joining = new Mac("joining", folder, { joining: true });
  const link = { syncId: "s1", themeAdopting: true };
  joining.adapters = [
    adapters.profilesAdapter(LINKS),
    adapters.profileThemesAdapter(() => ({ default: link }), () => joining.scope.records, () => delete link.themeAdopting),
  ];
  joining.with(() => S().updateProfile("default", { theme: own }));
  await rounds([joining], 3);
  assert.equal(joining.profile().name, "Home", "prof: arrived");
  assert.equal(joining.scope.records["pth:s1"], undefined, "nothing went out while the theme's file was downloading");

  folder.downloading.delete(themeFile);
  await rounds([joining, first], 3);
  assert.deepEqual(joining.profile().theme, THEME, "the downloaded theme applies");
  assert.equal(link.themeAdopting, undefined, "and the profile is adopted");
  assert.deepEqual(first.profile().theme, THEME, "and the first Mac keeps it");
  assert.equal(await rounds([joining, first], 3), 0);
});

function profileThemesAdapterV0241(links) {
  const dropAngle = ({ angle: _angle, ...look }) => look;
  const known = (theme) => ({ ...dropAngle(theme), ...(theme.dark ? { dark: dropAngle(theme.dark) } : {}) });
  return {
    prefix: "pth:",
    adoptRemoteOnJoin: true,
    extract: () => {
      const values = new Map();
      for (const [id, { syncId }] of Object.entries(links())) {
        const theme = S().profiles[id]?.theme;
        if (theme !== undefined) values.set(`pth:${syncId}`, theme ? { t: theme } : { preset: true });
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed) => {
      for (const [id, { syncId }] of Object.entries(links())) {
        const record = changed.has(`pth:${syncId}`) ? visible.get(`pth:${syncId}`) : null;
        if (record?.preset) S().updateProfile(id, { theme: null });
        else if (record?.t) S().updateProfile(id, { theme: known(record.t) });
      }
    },
  };
}

test("a theme's angles sync, and a Mac that drops them can't take them away", async () => {
  const folder = new Folder();
  const { mode: _mode, ...look } = THEME;
  const angled = { ...THEME, angle: 270, dark: { ...look, intensity: 0.5, angle: 45 } };
  const first = new Mac("first", folder);
  first.with(() => S().updateProfile("default", { theme: angled }));
  await first.sync();
  const second = new Mac("second", folder, { joining: true });
  const old = new Mac("old", folder, { joining: true });
  old.adapters = [adapters.profilesAdapter(LINKS), profileThemesAdapterV0241(LINKS)];
  await rounds([first, second, old], 3);
  assert.deepEqual(second.profile().theme, angled, "a newer Mac takes both angles");
  assert.equal(old.profile().theme.angle, undefined, "the older Mac keeps the theme without them");
  assert.equal(await rounds([first, second, old], 4), 0, "and they settle");

  old.with(() => S().updateProfile("default", { theme: { ...S().profiles.default.theme, intensity: 0.3 } }));
  await rounds([old, first, second], 3);
  for (const mac of [first, second]) {
    assert.equal(mac.profile().theme.intensity, 0.3, `${mac.id} takes the older Mac's edit`);
    assert.equal(mac.profile().theme.angle, 270, `${mac.id} keeps the angle`);
    assert.equal(mac.profile().theme.dark.angle, 45, `${mac.id} keeps the dark look's angle`);
  }
  assert.equal(await rounds([first, second, old], 4), 0, "and they settle again");

  second.with(() => S().updateProfile("default", { theme: { ...S().profiles.default.theme, angle: 0 } }));
  await rounds([second, first], 2);
  assert.equal(first.profile().theme.angle, 0, "a new angle reaches the other newer Mac");
});

test("a new custom theme without an angle doesn't take the previous theme's angle", async () => {
  const folder = new Folder();
  const a = new Mac("a", folder);
  a.with(() => S().updateProfile("default", { theme: { ...THEME, angle: 90 } }));
  await a.sync();
  const b = new Mac("b", folder, { joining: true });
  await rounds([a, b], 3);
  a.with(() => S().updateProfile("default", { theme: null }));
  await rounds([a, b], 2);
  b.with(() => S().updateProfile("default", { theme: THEME }));
  await rounds([b, a], 3);
  assert.deepEqual(a.profile().theme, THEME);
});

test("a theme without an angle publishes no angle record", async () => {
  const folder = new Folder();
  const a = new Mac("a", folder);
  a.with(() => S().updateProfile("default", { theme: THEME }));
  await a.sync();
  assert.ok(!Object.keys(a.scope.records).some((key) => key.endsWith(":angle")));
});
