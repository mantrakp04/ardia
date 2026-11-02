import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = false;

const folder = new Map();
const downloading = new Set();
const damaged = new Set();
let ids = 0;
globalThis.acTestNativeModules = {
  ArdiaSync: {
    newDeviceId: () => `id${++ids}`,
    deviceName: () => "Test Mac",
    createPhrase: async () => true,
    createChain: async () => {},
    enterPhrase: async () => ({ ok: true }),
    unlock: async () => true,
    forget: async () => {},
    chainStatus: async () => "ok",
    write: async (_folder, scope, payload) => {
      const id = `f${folder.size + 1}`;
      folder.set(id, { scope, payload });
      return id;
    },
    read: async (_folder, scope, known) => {
      const here = [...folder].filter(([id, f]) => f.scope === scope && !downloading.has(id));
      const readable = here.filter(([id]) => !damaged.has(id));
      const files = readable.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
      return { files, pending: [...downloading], damaged: [...damaged].map((id) => ({ id, age: 0 })), present: here.map(([id]) => id) };
    },
    remove: async (_folder, _scope, list) => list.forEach((id) => folder.delete(id)),
    sealLocal: async (text) => `sealed:${text}`,
    openLocal: async (sealed) => (sealed.startsWith("sealed:") ? sealed.slice(7) : null),
    readPasswords: async () => null,
  },
};

const shell = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { sharingProfiles } = await import("../profiles/profiles.ts");
const S = () => useBrowser.getState();

class Mac {
  constructor(name) {
    this.name = name;
    S().hydrate({});
    useBrowser.setState({ bookmarksReady: { "": true } });
    this.browser = S();
    this.docs = new Map();
  }
  async with(fn) {
    useBrowser.setState(this.browser, true);
    shell.docs.clear();
    for (const [k, v] of this.docs) shell.docs.set(k, v);
    try {
      return await fn();
    } finally {
      this.browser = S();
      this.docs = new Map(shell.docs);
    }
  }
}

const published = (prefix) =>
  [...folder.values()]
    .map((f) => JSON.parse(f.payload))
    .flatMap((f) => f.ops ?? Object.entries(f.records ?? {}).map(([k, r]) => ({ k, v: r.v })))
    .filter((op) => op.k.startsWith(prefix));

const THEME_B = {
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
const THEME_A = { ...THEME_B, intensity: 0.3, stops: [{ x: 0.5, y: 0.1, color: { r: 0.2, g: 0.3, b: 0.9, a: 1 } }] };

async function pairAgainstExistingTheme(local, tag) {
  folder.clear();
  const a = new Mac("A");
  const c = new Mac("C");
  const engineA = await import(`./engine.ts?pairA${tag}`);
  const engineC = await import(`./engine.ts?pairC${tag}`);
  await a.with(async () => {
    S().updateProfile("default", { theme: THEME_B });
    engineA.startSync();
    assert.ok("ok" in (await engineA.turnOnSync("/sync")));
    await engineA.syncNow();
    await engineA.syncNow();
  });
  await c.with(async () => {
    if (local) S().updateProfile("default", { theme: local });
    engineC.startSync();
    assert.ok("ok" in (await engineC.enterRecoveryPhrase("/sync", "words")));
    await engineC.syncNow();
    await engineC.syncNow();
    assert.deepEqual(S().profiles.default.theme, THEME_B, "the paired profile takes the synced theme");
  });
  for (let i = 0; i < 2; i++) {
    await a.with(() => engineA.syncNow());
    await c.with(() => engineC.syncNow());
  }
  await a.with(() => assert.deepEqual(S().profiles.default.theme, THEME_B, "the first Mac keeps its theme"));
  await c.with(() => assert.deepEqual(S().profiles.default.theme, THEME_B));
  const themes = published("pth:").map((op) => op.v);
  assert.ok(themes.every((v) => JSON.stringify(v) === JSON.stringify({ t: THEME_B })), `only the synced theme is ever published: ${JSON.stringify(themes)}`);
}

test("a Mac joining sync pairs its profile and takes the synced theme", () => pairAgainstExistingTheme(null, "1"));

test("a Mac joining sync with its own theme takes the synced one instead of publishing over it", () => pairAgainstExistingTheme(THEME_A, "2"));

const lastFile = () => [...folder.keys()].at(-1);
const themesFrom = () => published("pth:").map((op) => JSON.stringify(op.v));
const realNow = Date.now;

async function joinWhileThemeDownloads(tag, hold = downloading) {
  folder.clear();
  downloading.clear();
  damaged.clear();
  const a = new Mac("A");
  const c = new Mac("C");
  const engineA = await import(`./engine.ts?dlA${tag}`);
  const engineC = await import(`./engine.ts?dlC${tag}`);
  await a.with(async () => {
    S().updateProfile("default", { theme: THEME_B });
    engineA.startSync();
    assert.ok("ok" in (await engineA.turnOnSync("/sync")));
    await engineA.syncNow();
    await engineA.syncNow();
    const themeFile = [...folder].find(([, f]) => f.payload.includes('"pth:'))?.[0];
    assert.ok(themeFile);
    hold.add(themeFile);
    S().updateProfile("default", { name: "Home" });
    await engineA.syncNow();
  });
  await c.with(async () => {
    S().updateProfile("default", { theme: THEME_A });
    engineC.startSync();
    assert.ok("ok" in (await engineC.enterRecoveryPhrase("/sync", "words")));
    await engineC.syncNow();
    await engineC.syncNow();
    assert.ok(engineC.useSync.getState().remoteProfiles.every((p) => p.name !== "Personal"), "Personal paired");
    assert.deepEqual(S().profiles.default.theme, THEME_A);
  });
  return { a, c, engineA, engineC };
}

test("a joining Mac never publishes its theme while the synced one is still downloading, even after a day", async () => {
  const { c, engineC } = await joinWhileThemeDownloads("1");
  try {
    Date.now = () => realNow() + 2 * 86_400_000;
    await c.with(async () => {
      for (let i = 0; i < 3; i++) await engineC.syncNow();
      assert.deepEqual(S().profiles.default.theme, THEME_A, "still its own until the synced one arrives");
    });
    assert.ok(!themesFrom().includes(JSON.stringify({ t: THEME_A })), "its own theme was never published while adopting");
    const edited = { ...THEME_A, intensity: 0.66 };
    await c.with(async () => {
      engineC.adoptProfileTheme("default");
      S().updateProfile("default", { theme: edited });
      await engineC.syncNow();
    });
    assert.ok(themesFrom().includes(JSON.stringify({ t: edited })), "an explicit edit adopts and publishes");
  } finally {
    Date.now = realNow;
  }
});

test("a joining Mac keeps adopting across a restart and takes the theme when its file arrives", async () => {
  const { a, c, engineA } = await joinWhileThemeDownloads("2");
  const restarted = await import("./engine.ts?dlC2restart");
  await c.with(async () => {
    restarted.startSync();
    await restarted.syncNow();
    await restarted.syncNow();
  });
  assert.ok(!themesFrom().includes(JSON.stringify({ t: THEME_A })), "nothing published before or after the restart");
  downloading.clear();
  await c.with(async () => {
    await restarted.syncNow();
    assert.deepEqual(S().profiles.default.theme, THEME_B, "the synced theme applies once its file arrives");
  });
  const edited = { ...THEME_B, intensity: 0.55 };
  await c.with(async () => {
    S().updateProfile("default", { theme: edited });
    await restarted.syncNow();
  });
  await a.with(async () => {
    await engineA.syncNow();
    assert.deepEqual(S().profiles.default.theme, edited, "once adopted, its edits publish and reach the other Mac");
  });
});

test("an established profile's theme edit publishes while unrelated files are still downloading", async () => {
  folder.clear();
  downloading.clear();
  const a = new Mac("A");
  const c = new Mac("C");
  const engineA = await import("./engine.ts?estA");
  const engineC = await import("./engine.ts?estC");
  await a.with(async () => {
    S().updateProfile("default", { theme: THEME_B });
    engineA.startSync();
    assert.ok("ok" in (await engineA.turnOnSync("/sync")));
    await engineA.syncNow();
    await engineA.syncNow();
  });
  await c.with(async () => {
    engineC.startSync();
    assert.ok("ok" in (await engineC.enterRecoveryPhrase("/sync", "words")));
    await engineC.syncNow();
    await engineC.syncNow();
    assert.deepEqual(S().profiles.default.theme, THEME_B);
  });
  await a.with(async () => {
    S().updateProfile("default", { name: "Elsewhere" });
    await engineA.syncNow();
  });
  downloading.add(lastFile());
  await c.with(() => engineC.syncNow());
  const edited = { ...THEME_B, intensity: 0.42 };
  await c.with(async () => {
    S().updateProfile("default", { theme: edited });
    await engineC.syncNow();
  });
  assert.ok(themesFrom().includes(JSON.stringify({ t: edited })), "published despite the pending file");
});

const neverPublished = (theme) => !themesFrom().includes(JSON.stringify({ t: theme }));

test("turning a profile's sync off and on again keeps it adopting", async () => {
  const { c, engineC } = await joinWhileThemeDownloads("3");
  await c.with(async () => {
    engineC.setProfileSynced("default", false);
    await engineC.syncNow();
    engineC.setProfileSynced("default", true);
    await engineC.syncNow();
    await engineC.syncNow();
  });
  assert.ok(neverPublished(THEME_A), "its inherited theme isn't published after re-enabling");
});

test("a theme file given up as damaged after a day doesn't end adoption", async () => {
  const { c, engineC } = await joinWhileThemeDownloads("4", damaged);
  try {
    Date.now = () => realNow() + 2 * 86_400_000;
    await c.with(async () => {
      for (let i = 0; i < 3; i++) await engineC.syncNow();
    });
    assert.ok(neverPublished(THEME_A), "giving up on the file never authorises publication");
    const edited = { ...THEME_A, intensity: 0.71 };
    await c.with(async () => {
      engineC.adoptProfileTheme("default");
      S().updateProfile("default", { theme: edited });
      await engineC.syncNow();
    });
    assert.ok(!neverPublished(edited), "an explicit edit still does");
  } finally {
    Date.now = realNow;
  }
});

test("picking a preset while adopting keeps the preset when the late theme arrives", async () => {
  const { a, c, engineA, engineC } = await joinWhileThemeDownloads("5");
  const { choosePresetColor } = await import("../profiles/themeActions.ts");
  await c.with(async () => {
    S().updateProfile("default", { theme: undefined });
    choosePresetColor("default", "blue", engineC.adoptProfileTheme);
    await engineC.syncNow();
  });
  downloading.clear();
  await c.with(async () => {
    await engineC.syncNow();
    await engineC.syncNow();
    assert.equal(S().profiles.default.theme, null, "the user's preset stays");
    assert.equal(S().profiles.default.color, "blue");
  });
  await a.with(async () => {
    await engineA.syncNow();
    assert.equal(S().profiles.default.theme, null, "and reaches the other Mac");
  });
});

test("a leftover adoption flag on a theme that's already applied is cleared at startup", async () => {
  const { a, c, engineA, engineC } = await joinWhileThemeDownloads("6");
  downloading.clear();
  await c.with(async () => {
    await engineC.syncNow();
    assert.deepEqual(S().profiles.default.theme, THEME_B);
  });
  const edited = { ...THEME_B, intensity: 0.33 };
  await c.with(async () => {
    const saved = JSON.parse(shell.docs.get("sync.json"));
    saved.profiles.default.themeAdopting = true;
    shell.docs.set("sync.json", JSON.stringify(saved));
    S().updateProfile("default", { theme: edited });
  });
  const restarted = await import("./engine.ts?leftover6");
  await c.with(async () => {
    restarted.startSync();
    await new Promise((r) => setImmediate(r));
    await restarted.syncNow();
  });
  assert.ok(!neverPublished(edited), "the edit made where the flag was left behind publishes");
  await a.with(async () => {
    await engineA.syncNow();
    assert.deepEqual(S().profiles.default.theme, edited);
  });
});
