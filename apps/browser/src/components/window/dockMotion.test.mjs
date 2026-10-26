import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const dm = { ...(await import("./dockMotion.ts")), ...(await import("../../state/windows/dockMotion.ts")) };
const motion = await import("../ui/motion.ts");
const { toolbarGeometry } = await import("./geometry.ts");
const { useBrowser } = await import("../../state/browser/store.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../../state/session/persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();

const DIA = [
  [0.0337, 0.303], [0.0629, 0.616], [0.0837, 0.805], [0.1212, 0.968], [0.1379, 1.011], [0.1629, 1.011], [0.1837, 1.003],
  [0.0263, 0.246], [0.0596, 0.524], [0.0805, 0.8], [0.1055, 0.951], [0.1305, 1.008], [0.1555, 1.011], [0.1805, 1.003],
  [0.0324, 0.316], [0.0657, 0.586], [0.0949, 0.846], [0.1032, 0.973], [0.1365, 1.011], [0.1532, 1.011], [0.1782, 1.005],
];

test("the spring follows Dia's measured motion (rms under 4 % of the travel, the recorder's own timing jitter)", () => {
  const rms = Math.sqrt(DIA.reduce((sum, [t, x]) => sum + (dm.springAt(t) - x) ** 2, 0) / DIA.length);
  assert.ok(rms < 0.04, `rms ${rms.toFixed(3)}`);
  assert.ok(dm.springAt(0.1) > 0.88);
  const peak = Math.max(...Array.from({ length: 60 }, (_, i) => dm.springAt(i / 120)));
  assert.ok(peak > 1.005 && peak < 1.03, `peak ${peak}`);
  assert.ok(Math.abs(dm.springAt(0.3) - 1) < 0.003);
});

test("React Native's spring parameters are the same spring", () => {
  const { stiffness, damping, mass } = motion.spring(dm.DOCK_SPRING);
  assert.equal(mass, 1);
  const omega = Math.sqrt(stiffness);
  assert.ok(Math.abs(omega - (2 * Math.PI) / 0.215) < 1e-9);
  assert.ok(Math.abs(damping / (2 * omega) - 0.79) < 1e-9);
});

test("the traffic lights go with the sidebar: at their place when it's shown, past the window's edge when it's hidden", () => {
  assert.equal(dm.lightsCenter(0), null, "shown: nothing to move");
  assert.equal(dm.lightsCenter(0.2), null, "a rounding hair from shown: still their place");
  assert.deepEqual(dm.lightsCenter(95), [25 - 95, 27], "half way out");
  const [px, py] = dm.PEEK_ORIGIN;
  assert.deepEqual(dm.lightsCenter(-px, py), [25 + px, 27 + py], "in the peek panel: as far in as the panel");
  for (const width of [160, 190, 400]) {
    const [x] = dm.lightsCenter(width);
    assert.ok(x + 46 + 7 < 0, `width ${width}: all three past the left edge`);
  }
});

test("the peek panel covers the card's rounded corners, so no sliver of the page shows round its own", async () => {
  const { layout } = await import("../ui/theme.ts");
  const [px, py] = dm.PEEK_ORIGIN;
  const height = 860;
  const panel = { left: px, top: py, bottom: height - dm.PEEK_BOTTOM, r: dm.PEEK_RADIUS };
  const card = { left: layout.cardInset, top: layout.cardTop, bottom: height - layout.cardInset, r: layout.cardRadius };
  assert.ok(panel.left <= card.left && panel.top <= card.top && panel.bottom >= card.bottom, "the panel's edges reach past the card's");
  const corners = [
    [[panel.left + panel.r, panel.top + panel.r], [card.left + card.r, card.top + card.r]],
    [[panel.left + panel.r, panel.bottom - panel.r], [card.left + card.r, card.bottom - card.r]],
  ];
  for (const [[ax, ay], [bx, by]] of corners) {
    const apart = Math.hypot(ax - bx, ay - by);
    assert.ok(apart + card.r <= panel.r - 0.5, `the card's corner arc stays half a point inside the panel's (${apart.toFixed(2)} apart)`);
  }
});

test("with the address field in the sidebar the lights sit Arc's 3 pt higher, docked, sliding and in the peek", () => {
  const arc = dm.ARC_LIGHTS_CENTER;
  assert.deepEqual(arc, [dm.LIGHTS_CENTER[0], dm.LIGHTS_CENTER[1] - 3]);
  assert.deepEqual(dm.lightsCenter(0, 0, arc), [25, 24], "docked: placed, not left at AppKit's default");
  assert.deepEqual(dm.lightsCenter(95, 0, arc), [25 - 95, 24], "half way out on the same row");
  const [px, py] = dm.PEEK_ORIGIN;
  assert.deepEqual(dm.lightsCenter(-px, py, arc), [25 + px, 24 + py], "in the peek panel");
});

test("the card's left edge runs from the inset to the sidebar's width", () => {
  assert.equal(dm.cardLeft(1, 190, 7), 190);
  assert.equal(dm.cardLeft(0, 190, 7), 7);
  assert.equal(dm.cardLeft(0.5, 190, 7), 98.5);
});

test("the motion flag is per window, and ending it twice is harmless", () => {
  dm.setDockMoving("a", true);
  assert.equal(dm.dockMoving("a"), true);
  assert.equal(dm.dockMoving("b"), false);
  const before = dm.useDockMotion.getState();
  dm.setDockMoving("a", true);
  assert.equal(dm.useDockMotion.getState(), before, "no store update for no change");
  dm.setDockMoving("a", false);
  dm.setDockMoving("a", false);
  assert.equal(dm.dockMoving("a"), false);
  assert.deepEqual(dm.useDockMotion.getState().moving, {});
});

test("the toolbar's buttons don't move with the sidebar: the hidden sidebar's toolbar starts at the card's edge, as Dia's", () => {
  const g = toolbarGeometry({ sidebarButton: true });
  assert.deepEqual([g.sidebarButton, g.back, g.forward, g.reload], [21, 56, 92, 127]);
});

test("the sidebar's own button (address bar in the sidebar) always fits; back, forward and reload as there's room, never overlapping", () => {
  assert.deepEqual(dm.navButtonsFitting(160).buttons, ["back"]);
  const narrow = dm.navButtonsFitting(190);
  assert.deepEqual(narrow.buttons, ["back", "forward"], "the default width keeps the back and forward pair, as Arc and Dia show it; reload gives way first");
  assert.equal(narrow.step, 35, "Dia's pitch");
  const closing = dm.navButtonsFitting(220);
  assert.deepEqual(closing.buttons, ["back", "forward", "reload"]);
  assert.ok(closing.step >= 30 + dm.HEADER_MIN_GAP && closing.step < 35, "closed up, plates apart");
  assert.deepEqual(dm.navButtonsFitting(224.75), { buttons: ["back", "forward", "reload"], step: 35 });
  assert.deepEqual(dm.navButtonsFitting(400), { buttons: ["back", "forward", "reload"], step: 35 });
  assert.equal(dm.navButtonsFitting(100).buttons.length, 0);
  for (let w = 150; w <= 400; w += 0.5) {
    const { buttons, step } = dm.navButtonsFitting(w);
    const last = w - dm.HEADER_TOOLS.edge - 15;
    const centres = [dm.HEADER_TOOLS.toggleX, ...buttons.map((_, i) => last - (buttons.length - 1 - i) * step)];
    for (let i = 1; i < centres.length; i++) assert.ok(centres[i] - centres[i - 1] >= 30 + dm.HEADER_MIN_GAP - 1e-9, `${w}: ${centres}`);
  }
});

test("with the sidebar button hidden (Settings › Tabs), back, forward and reload take its place and all fit at the default width", () => {
  assert.deepEqual(dm.navButtonsFitting(190, 30, false), { buttons: ["back", "forward", "reload"], step: 35 });
  assert.deepEqual(dm.navButtonsFitting(150, 30, false).buttons, ["back", "forward"]);
  for (let w = 120; w <= 400; w += 0.5) {
    const { buttons, step } = dm.navButtonsFitting(w, 30, false);
    if (!buttons.length) continue;
    const first = w - dm.HEADER_TOOLS.edge - 15 - (buttons.length - 1) * step;
    assert.ok(first - 15 >= dm.HEADER_TOOLS.lightsRight + dm.HEADER_MIN_GAP - 1e-9, `${w}: first plate clears the traffic lights`);
    assert.ok(step >= 30 + dm.HEADER_MIN_GAP - 1e-9, `${w}: plates apart`);
  }
});

test("hidden or shown is each window's own, and survives a quit and relaunch; new windows open with it shown", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startPersistence();
  const a = S().createWindow({ url: "a.com" });
  const b = S().createWindow({ url: "b.com" });
  S().toggleSidebar(a);
  assert.equal(S().windows[a].sidebarOpen, false);
  assert.equal(S().windows[b].sidebarOpen, true, "the other window keeps its sidebar");
  flushPersistence();
  S().hydrate(loadSession());
  assert.equal(S().windows[a].sidebarOpen, false, "relaunch: still hidden");
  assert.equal(S().windows[b].sidebarOpen, true, "relaunch: still shown");

  S().toggleSidebar(a);
  flushPersistence();
  S().hydrate(loadSession());
  assert.equal(S().windows[a].sidebarOpen, true);

  S().toggleSidebar(a);
  S().closeWindow(a);
  flushPersistence();
  S().hydrate(loadSession());
  assert.equal(S().windows[a], undefined, "closed: gone after a relaunch");
  S().reopenClosedWindow();
  const reopened = S().windowOrder.find((id) => id !== b);
  assert.ok(reopened, "the closed window came back");
  assert.equal(S().windows[reopened].sidebarOpen, false, "reopened as it was closed");
  const c = S().createWindow({ url: "c.com" });
  assert.equal(S().windows[c].sidebarOpen, true);
  stop();
});

const springAt = (t, s) => dm.springAt(t, s);
const fitT0 = (points, curve) => {
  let best = Infinity;
  for (let t0 = -0.04; t0 <= 0.04; t0 += 0.001) {
    const err = points.reduce((sum, [t, x]) => sum + (curve(t - t0) - x) ** 2, 0);
    best = Math.min(best, err);
  }
  return Math.sqrt(best / points.length);
};
const ARC_PEEK_IN = [
  [[0, 0.219], [0.025, 0.473], [0.041, 0.686], [0.066, 0.931], [0.083, 0.983], [0.1, 1.006], [0.116, 1.015], [0.133, 1.015], [0.15, 1.013], [0.166, 1.009], [0.183, 1.004], [0.2, 1.002], [0.216, 1]],
  [[0, 0.09], [0.034, 0.462], [0.042, 0.677], [0.059, 0.832], [0.092, 0.959], [0.109, 0.998], [0.117, 1.013], [0.134, 1.015], [0.15, 1.013], [0.184, 1.006], [0.2, 1.004], [0.217, 1.002], [0.234, 1]],
  [[0, 0.254], [0.017, 0.503], [0.033, 0.71], [0.05, 0.903], [0.067, 0.968], [0.083, 1], [0.1, 1.013], [0.117, 1.015], [0.133, 1.013], [0.158, 1.009], [0.175, 1.004], [0.2, 1.002], [0.217, 1]],
];
const ARC_HIDE = [
  [[0, 0], [0.017, 0.452], [0.042, 0.83], [0.059, 0.945], [0.075, 1]],
  [[0, 0], [0.017, 0.328], [0.034, 0.654], [0.05, 0.853], [0.075, 0.956], [0.092, 1]],
];

test("Arc's peek slides in on its measured spring and leaves on its ease-in-out; its hide is a 100 ms ease-out", () => {
  for (const motion of ARC_PEEK_IN) {
    const rms = fitT0(motion, (t) => springAt(t, dm.ARC_PEEK_SPRING));
    assert.ok(rms < 0.04, `peek in rms ${rms.toFixed(3)}`);
  }
  const hide = (t) => (t <= 0 ? 0 : t >= dm.ARC_HIDE_MS / 1000 ? 1 : dm.easeOutCubic(t / (dm.ARC_HIDE_MS / 1000)));
  for (const motion of ARC_HIDE) {
    const rms = fitT0(motion, hide);
    assert.ok(rms < 0.05, `hide rms ${rms.toFixed(3)}`);
  }
  const dia = Math.max(...ARC_HIDE.map((m) => fitT0(m, (t) => dm.springAt(t))));
  assert.ok(dia > 0.06, `Dia's spring against Arc's hide: rms ${dia.toFixed(3)}`);
  assert.equal(dm.easeInOutCubic(0), 0);
  assert.equal(dm.easeInOutCubic(0.5), 0.5);
  assert.equal(dm.easeInOutCubic(1), 1);
  const peak = Math.max(...Array.from({ length: 60 }, (_, i) => springAt(i / 120, dm.ARC_PEEK_SPRING)));
  assert.ok(peak > 1.01 && peak < 1.03, `the panel's overshoot ${peak}`);
});

test("a peek that's out is remembered per window (Arc docks from it at once)", () => {
  assert.equal(dm.peekShown("w1"), false);
  dm.setPeekShown("w1", true);
  assert.equal(dm.peekShown("w1"), true);
  assert.equal(dm.peekShown("w2"), false);
  dm.setPeekShown("w1", false);
  assert.equal(dm.peekShown("w1"), false);
});

test("the peek panel covers the page up to its right edge, only while it's out", () => {
  assert.equal(dm.overPeek("w1", 0), false);
  dm.setPeekShown("w1", true, 5 + 240);
  assert.equal(dm.overPeek("w1", 120), true);
  assert.equal(dm.overPeek("w1", 244.5), true);
  assert.equal(dm.overPeek("w1", 245), false);
  assert.equal(dm.overPeek("w2", 120), false);
  dm.setPeekShown("w1", false);
  assert.equal(dm.overPeek("w1", 120), false);
});

test("Arc's layout keeps the address bar in a hidden sidebar (no toolbar on the card); Dia's layout and the switch off don't", async () => {
  const { addressBarInSidebar } = await import("../../state/windows/layout.ts");
  const { reloadSwitches } = await import("../../platform/killSwitches.ts");
  stub.docs.clear();
  reloadSwitches();
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  S().updateSettings({ addressBar: "sidebar", tabLayout: "sidebar" });
  assert.equal(addressBarInSidebar(S(), w), true, "shown");
  S().toggleSidebar(w);
  assert.equal(addressBarInSidebar(S(), w), true, "hidden: still in the sidebar (Arc)");
  S().updateSettings({ addressBar: "toolbar" });
  assert.equal(addressBarInSidebar(S(), w), false, "Dia's layout: the toolbar's");
  S().updateSettings({ addressBar: "sidebar" });
  stub.docs.set("switches-cache.json", JSON.stringify({ version: 1, switches: { sidebarSlide: false } }));
  reloadSwitches();
  assert.equal(addressBarInSidebar(S(), w), false, "switch off: a hidden sidebar's bar moves to the card, as before");
  S().toggleSidebar(w);
  assert.equal(addressBarInSidebar(S(), w), true, "switch off, shown: in the sidebar");
  stub.docs.clear();
  reloadSwitches();
});
