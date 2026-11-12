import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const dm = { ...(await import("./dockMotion.ts")), ...(await import("./tokens.ts")), ...(await import("../../state/windows/dockMotion.ts")), ...(await import("./cardFrame.ts")) };
const { PAGE_FRAME, pageFrameOf } = await import("../../lib/windowLayout.ts");
const DEFAULT_PEEK = dm.cardFrameOf(PAGE_FRAME.default).peek;
const motion = await import("../ui/motion.ts");
const { toolbarGeometry } = await import("./geometry.ts");
const { useBrowser } = await import("../../state/browser/store.ts");
const { tabsShownIn } = await import("../../state/browser/model.ts");
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
  assert.deepEqual(dm.lightsCenter(0), [25, 30], "shown: on the toolbar's row, 9 pt card top + 21");
  assert.deepEqual(dm.lightsCenter(0.2), [25, 30], "a rounding hair from shown: still their place");
  assert.deepEqual(dm.lightsCenter(95), [25 - 95, 30], "half way out");
  const { left: px, top: py } = DEFAULT_PEEK;
  assert.deepEqual(dm.lightsCenter(-px, py), [25 + px, 30 + py], "in the peek panel: as far in as the panel");
  for (const width of [160, 190, 400]) {
    const [x] = dm.lightsCenter(width);
    assert.ok(x + 46 + 7 < 0, `width ${width}: all three past the left edge`);
  }
});

test("the peek keeps the same gap on every edge, with a 4 pt minimum", () => {
  for (let inset = PAGE_FRAME.min; inset <= PAGE_FRAME.max; inset++) {
    const frame = dm.cardFrameOf(inset);
    const gap = Math.max(4, inset);
    assert.deepEqual([frame.peek.left, frame.peek.top, frame.peek.bottom], [gap, gap, gap]);
    if (inset >= 4) checkPeekCoversCard(frame);
  }
  assert.equal(DEFAULT_PEEK.left, PAGE_FRAME.default);
});

function checkPeekCoversCard(frame) {
  const { left: px, top: py, bottom: pb, radius: pr } = frame.peek;
  const height = 860;
  const panel = { left: px, top: py, bottom: height - pb, r: pr };
  const card = { left: frame.inset, top: frame.inset, bottom: height - frame.inset, r: frame.radius };
  assert.equal(panel.top, card.top, "the panel's top lines up with the card's");
  assert.equal(panel.bottom, card.bottom, "the panel's bottom lines up with the card's");
  assert.ok(panel.left <= card.left, "the panel's left edge reaches past the card's");
  const insidePanel = (x, y) => {
    const cx = Math.max(panel.left + panel.r, x);
    const cy = Math.min(Math.max(panel.top + panel.r, y), panel.bottom - panel.r);
    return x >= panel.left && y >= panel.top && y <= panel.bottom && Math.hypot(x - cx, y - cy) <= panel.r + 1e-9;
  };
  for (const [cy, sy] of [[card.top + card.r, -1], [card.bottom - card.r, 1]]) {
    for (let a = 0; a <= 90; a += 1) {
      const t = (a * Math.PI) / 180;
      const x = card.left + card.r - card.r * Math.cos(t);
      const y = cy + sy * card.r * Math.sin(t);
      assert.ok(insidePanel(x, y), `frame ${frame.inset}: the card's corner arc at ${a}° (${x.toFixed(2)}, ${y.toFixed(2)}) stays inside the panel`);
    }
  }
}

test("with the address field in the sidebar the lights sit on Arc's header row, docked, sliding and in the peek", () => {
  const arc = dm.ARC_LIGHTS_CENTER;
  assert.deepEqual(arc, [dm.LIGHTS_CENTER[0], 24]);
  assert.deepEqual(dm.lightsCenter(0, 0, arc), [25, 24], "docked: placed, not left at AppKit's default");
  assert.deepEqual(dm.lightsCenter(95, 0, arc), [25 - 95, 24], "half way out on the same row");
  const { left: px, top: py } = DEFAULT_PEEK;
  assert.deepEqual(dm.lightsCenter(-px, py, arc), [25 + px, 24 + py], "in the peek panel");
});

test("the sidebar's rows sit 9 pt from the window's edge and 9 pt from the card at the default frame; a thinner frame never pushes the card into the sidebar's own padding", async () => {
  const { layout } = await import("../ui/theme.ts");
  assert.equal(PAGE_FRAME.default, 9);
  assert.equal(layout.sidebarInset, PAGE_FRAME.default, "rows start where the frame's thickness ends");
  assert.equal(dm.dockedCardInset(190, 9) - (190 - layout.sidebarInset), 9);
  assert.equal(dm.dockedCardInset(190, 0), 190, "edge to edge: the card starts at the sidebar's edge");
  assert.equal(dm.dockedCardInset(190, 12), 193);
  assert.equal(dm.cardInsetAt(1, 190, 9), 190);
  assert.equal(dm.cardInsetAt(0, 190, 9), 9);
  assert.equal(dm.cardInsetAt(0.5, 190, 9), 99.5);
});

test("the card radius follows the native window radius minus the frame, and the toolbar's lights stay 21 pt into the card", () => {
  assert.equal(dm.cardFrameOf(9).radius, 10);
  assert.equal(dm.cardFrameOf(0).radius, 0, "edge to edge: square corners; the window rounds the page");
  assert.equal(dm.cardFrameOf(12).radius, 7);
  assert.equal(dm.cardFrameOf(4).radius, 15);
  assert.equal(pageFrameOf(18, 19, dm.PEEK_RADIUS).radius, 2);
  assert.ok(dm.cardFrameOf(0).splitGap > 0, "split panes keep a hairline gap edge to edge, so they still read as two pages");
  assert.deepEqual(dm.toolbarLightsCenter(false, 0), [25, 21]);
  assert.deepEqual(dm.toolbarLightsCenter(false), [...dm.LIGHTS_CENTER]);
  assert.equal(dm.toolbarLightsCenter(false, 4), dm.toolbarLightsCenter(false, 4), "one array per frame, so effects keyed on it settle");
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

test("with the sidebar on the right the window buttons ride it: anchored to the window's right edge, where the left sidebar would put them inside it", () => {
  assert.deepEqual(dm.sidebarLightsCenter(false, 240, 0, 0, dm.LIGHTS_CENTER), [...dm.LIGHTS_CENTER]);
  assert.deepEqual(dm.sidebarLightsCenter(true, 240, 0, 0, dm.LIGHTS_CENTER), [240 - dm.LIGHTS_CENTER[0], dm.LIGHTS_CENTER[1], "right"], "docked: 25 pt into the sidebar, as on the left");
  assert.deepEqual(dm.sidebarLightsCenter(true, 240, 240, 0, dm.ARC_LIGHTS_CENTER), [-dm.ARC_LIGHTS_CENTER[0], dm.ARC_LIGHTS_CENTER[1], "right"], "hidden: past the right edge with the sidebar");
  assert.deepEqual(dm.sidebarLightsCenter(true, 240, 100.3, 9), [240 - 25 - 100.5, dm.LIGHTS_CENTER[1] + 9, "right"], "half-point steps, as on the left");
});

test("the peek's span and hold mirror for a sidebar on the right", () => {
  assert.deepEqual(dm.peekSpan(240, false, 1200, 5), [-Infinity, 245]);
  assert.deepEqual(dm.peekSpan(240, true, 1200, 5), [955, Infinity]);
  const hold = dm.peekHoldWidth(240, 5);
  assert.equal(dm.inPeekHold(dm.fromSidebarEdgeInStrip(-1, true), 10, hold, 700), true, "leaving the right strip toward the peek stays in the hold");
  assert.equal(dm.inPeekHold(dm.fromSidebarEdgeInStrip(dm.PEEK_EDGE_STRIP - hold - 1, true), 10, hold, 700), false);
  assert.equal(dm.inPeekHold(dm.fromSidebarEdgeInStrip(dm.PEEK_EDGE_STRIP + 1, true), 10, hold, 700), false, "past the window's right edge");
  assert.equal(dm.fromSidebarEdgeInStrip(30, false), 30);
});

test("the sidebar's own button (address bar in the sidebar) always fits; back, forward and reload as there's room, never overlapping", () => {
  assert.deepEqual(dm.navButtonsFitting(160).buttons, ["back"]);
  const narrow = dm.navButtonsFitting(190);
  assert.deepEqual(narrow.buttons, ["back", "forward"], "the default width keeps the back and forward pair, as Arc and Dia show it; reload gives way first");
  assert.equal(narrow.step, 33.625, "closed up a little: the last plate ends on the field's edge, 9 pt in");
  assert.deepEqual(dm.navButtonsFitting(212.5).buttons, ["back", "forward"]);
  const tightest = dm.navButtonsFitting(213);
  assert.deepEqual(tightest.buttons, ["back", "forward", "reload"], "reload is back from 213 pt, the buttons 30 pt apart");
  assert.ok(tightest.step >= 30 && tightest.step < 30.5);
  const closing = dm.navButtonsFitting(223);
  assert.deepEqual(closing.buttons, ["back", "forward", "reload"]);
  assert.ok(closing.step >= 30 && closing.step < 35, "closed up, plates apart");
  assert.deepEqual(dm.navButtonsFitting(227.75), { buttons: ["back", "forward", "reload"], step: 35 });
  assert.deepEqual(dm.navButtonsFitting(400), { buttons: ["back", "forward", "reload"], step: 35 });
  assert.equal(dm.navButtonsFitting(100).buttons.length, 0);
  for (let w = 150; w <= 400; w += 0.5) {
    const { buttons, step } = dm.navButtonsFitting(w);
    const last = w - dm.HEADER_TOOLS.edge - 15;
    const centres = [dm.HEADER_TOOLS.toggleX, ...buttons.map((_, i) => last - (buttons.length - 1 - i) * step)];
    for (let i = 1; i < centres.length; i++) assert.ok(centres[i] - centres[i - 1] >= 30 - 1e-9, `${w}: ${centres}`);
  }
});

test("in window full screen the sidebar's button sits at Arc's 29 pt, with no room left for traffic lights (macOS shows them in its own title bar)", () => {
  assert.equal(dm.headerToggleX(true), 29);
  assert.equal(dm.headerToggleX(false), dm.HEADER_TOOLS.toggleX);
  for (let w = 150; w <= 400; w += 0.5) {
    const { buttons, step } = dm.navButtonsFitting(w, 30, true, dm.headerToggleX(true));
    const windowed = dm.navButtonsFitting(w).buttons.length;
    assert.ok(buttons.length >= windowed, `${w}: full screen never fits fewer buttons`);
    const last = w - dm.HEADER_TOOLS.edge - 15;
    const centres = [29, ...buttons.map((_, i) => last - (buttons.length - 1 - i) * step)];
    for (let i = 1; i < centres.length; i++) assert.ok(centres[i] - centres[i - 1] >= 30 - 1e-9, `${w}: ${centres}`);
  }
});

test("hidden or shown is one setting for every window, and survives a quit and relaunch; new and reopened windows follow it", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startPersistence();
  const shown = (id) => tabsShownIn(S(), id);
  const a = S().createWindow({ url: "a.com" });
  const b = S().createWindow({ url: "b.com" });
  S().toggleSidebar(a);
  assert.deepEqual([shown(a), shown(b)], [false, false], "every window hides its tabs");
  flushPersistence();
  S().hydrate(loadSession());
  assert.deepEqual([shown(a), shown(b)], [false, false], "relaunch: still hidden");

  S().toggleSidebar(b);
  flushPersistence();
  S().hydrate(loadSession());
  assert.deepEqual([shown(a), shown(b)], [true, true], "relaunch: still shown");

  S().toggleSidebar(a);
  S().closeWindow(a);
  flushPersistence();
  S().hydrate(loadSession());
  assert.equal(S().windows[a], undefined, "closed: gone after a relaunch");
  S().reopenClosedWindow();
  const reopened = S().windowOrder.find((id) => id !== b);
  assert.ok(reopened, "the closed window came back");
  assert.equal(shown(reopened), false, "reopened as the setting says");
  const c = S().createWindow({ url: "c.com" });
  assert.equal(shown(c), false, "the last choice was hidden");
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
  const peak = Math.max(...Array.from({ length: 400 }, (_, i) => springAt(i / 1000, dm.ARC_PEEK_SPRING)));
  const arcPeak = Math.max(...ARC_PEEK_IN.flat().map(([, x]) => x));
  assert.ok(Math.abs(peak - arcPeak) < 0.002, `the panel's overshoot ${peak}, Arc's ${arcPeak}`);
});

test("the peek stays off the window edge even when the page frame is zero", () => {
  const frameZero = dm.cardFrameOf(PAGE_FRAME.min).peek;
  assert.deepEqual([frameZero.left, frameZero.top, frameZero.bottom], [4, 4, 4]);
  assert.equal(dm.peekBleed(frameZero.left), 0);
  assert.equal(dm.peekBleed(DEFAULT_PEEK.left), 0);
});

test("the peek panel covers the page up to its right edge, only while it's out", () => {
  assert.equal(dm.overPeek("w1", 0), false);
  dm.setPeekShown("w1", true, [-Infinity, 5 + 240]);
  assert.equal(dm.overPeek("w1", 120), true);
  assert.equal(dm.overPeek("w1", 244.5), true);
  assert.equal(dm.overPeek("w1", 245), false);
  assert.equal(dm.overPeek("w2", 120), false);
  dm.setPeekShown("w1", false);
  assert.equal(dm.overPeek("w1", 120), false);
});

test("a peek from the right edge covers the page from its left edge to the window's right", () => {
  dm.setPeekShown("w1", true, [1200 - 5 - 240, Infinity]);
  assert.equal(dm.overPeek("w1", 120), false);
  assert.equal(dm.overPeek("w1", 954.5), false);
  assert.equal(dm.overPeek("w1", 955), true);
  assert.equal(dm.overPeek("w1", 1199), true);
  dm.setPeekShown("w1", false);
  assert.equal(dm.overPeek("w1", 1199), false);
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

test("the dock is fullscreen, docked, peeking, hiding or away, and only a still, undocked sidebar watches the left edge", () => {
  const st = (o) => dm.dockState({ open: false, fullscreen: false, moving: false, peekLive: false, ...o });
  assert.equal(st({ fullscreen: true, open: true, peekLive: true }), "fullscreen");
  assert.equal(st({ open: true, moving: true }), "docked");
  assert.equal(st({ peekLive: true }), "peeking");
  assert.equal(st({ peekLive: true, moving: true }), "peeking");
  assert.equal(st({ moving: true }), "hiding");
  assert.equal(st({}), "away");
  assert.equal(st({ peekLive: true, peekLeaving: true }), "leaving");
  assert.equal(st({ peekLeaving: true }), "away");
  assert.deepEqual(["fullscreen", "docked", "peeking", "leaving", "hiding", "away"].map(dm.shownAs), ["fullscreen", "docked", "peek", "peek", "away", "away"]);
  assert.equal(dm.watchesEdge("leaving", false), true);
  assert.equal(dm.watchesEdge("away", false), true);
  assert.equal(dm.watchesEdge("peeking", false), true);
  assert.equal(dm.watchesEdge("peeking", true), false);
  assert.equal(dm.watchesEdge("hiding", true), false);
  assert.equal(dm.watchesEdge("docked", false), false);
  assert.equal(dm.watchesEdge("fullscreen", false), false);
});

test("while the peek slides away only the window's edge brings it back, not the column it is leaving (#1192)", () => {
  const W = 1000;
  for (const x of [8, 40, 110, 250]) assert.equal(dm.edgeEventReveals("leaving", x, false, W), false, `left column x ${x}`);
  for (const x of [-20, 0, 7]) assert.equal(dm.edgeEventReveals("leaving", x, false, W), true, `left edge x ${x}`);
  for (const x of [W - 9, W - 110]) assert.equal(dm.edgeEventReveals("leaving", x, true, W), false, `right column x ${x}`);
  for (const x of [W - 8, W - 1, W + 20]) assert.equal(dm.edgeEventReveals("leaving", x, true, W), true, `right edge x ${x}`);
  for (const state of ["peeking", "away"]) assert.equal(dm.edgeEventReveals(state, 110, false, W), true, state);
  assert.equal(dm.edgeWatchWidth(false, false, dm.peekHoldWidth(240, 5), 6), dm.PEEK_EDGE_STRIP, "leaving watches the edge strip, not the column");
});

test("the peek stays out within 24 pt of its right edge, the window's full height", () => {
  const hold = dm.peekHoldWidth(240, 5);
  assert.equal(hold, 5 + 240 + 24);
  assert.equal(dm.inPeekHold(hold - 1, 10, hold, 700), true);
  assert.equal(dm.inPeekHold(hold, 10, hold, 700), false);
  assert.equal(dm.inPeekHold(10, 699, hold, 700), true);
  assert.equal(dm.inPeekHold(10, 700, hold, 700), false);
  assert.equal(dm.inPeekHold(-1, 10, hold, 700), false);
  assert.equal(dm.inPeekHold(10, 10, hold, Infinity), true, "before the hold zone has laid out");
});

test("the native left-edge watch spans the hold while peeking, the edge strip during a tab drag or when the frame is thinner than the strip, nothing otherwise", () => {
  assert.equal(dm.edgeWatchWidth(true, true, 269, 9), 269);
  assert.equal(dm.edgeWatchWidth(false, true, 269, 9), 8);
  assert.equal(dm.edgeWatchWidth(false, false, 269, 9), 0);
  assert.equal(dm.edgeWatchWidth(false, false, 269, 0), 8, "edge to edge the strip would cover the page, so the native watch takes it and clicks reach the page");
  assert.equal(dm.edgeStripOverPage(8), false);
  assert.equal(dm.edgeStripOverPage(7), true);
});

test("the dock jumps when it can't animate or Arc docks from an open peek, Arc hides on its ease-out, and otherwise springs", () => {
  const mv = (o) => dm.dockMove({ open: true, animated: true, arc: false, peekOut: false, ...o });
  assert.equal(mv({ animated: false }), "jump");
  assert.equal(mv({ animated: false, open: false, arc: true }), "jump");
  assert.equal(mv({ arc: true, peekOut: true }), "jump");
  assert.equal(mv({ arc: true }), "spring");
  assert.equal(mv({ arc: true, open: false, peekOut: true }), "arcHide");
  assert.equal(mv({ open: false }), "spring");
  assert.equal(mv({ peekOut: true }), "spring");
});
