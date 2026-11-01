import assert from "node:assert/strict";
import test from "node:test";
import { clampInto, cornerRect, flingTarget, frameOf, handleAt, parseFrame, placeFrame, resizeFrom, springSettled, springStep, PLAYER_INSET } from "./pipGeometry.ts";
import { planHoles } from "./playerHoles.ts";
import { floatingPieces, holeClipPath } from "./pageHoles.ts";
import { positionAt, readPlayerEvent } from "./pipPlayer.ts";

const area = { x: 200, y: 50, width: 1000, height: 700 };
const aspect = 16 / 9;

test("the first player sits in the content card's bottom right, inset like Dia's corner rule", () => {
  const rect = placeFrame(null, area, aspect);
  assert.equal(rect.width, 280);
  assert.equal(rect.height, Math.round(280 / aspect));
  assert.equal(rect.x + rect.width, area.x + area.width - PLAYER_INSET);
  assert.equal(rect.y + rect.height, area.y + area.height - PLAYER_INSET);
});

test("a remembered frame keeps its corner and offsets when the window resizes", () => {
  const moved = { x: 230, y: 90, width: 320, height: 180 };
  const frame = frameOf(moved, area);
  assert.deepEqual(frame, { corner: "topLeft", dx: 30, dy: 40, width: 320 });
  const wider = { ...area, width: 1400 };
  assert.deepEqual(placeFrame(frame, wider, aspect), { x: 230, y: 90, width: 320, height: 180 });
  const right = frameOf({ x: 900, y: 500, width: 280, height: 158 }, area);
  assert.equal(right.corner, "bottomRight");
  const placed = placeFrame(right, wider, aspect);
  assert.equal(area.x + wider.width - placed.x - placed.width, right.dx);
});

test("a stored frame is validated before use", () => {
  assert.equal(parseFrame("not json"), null);
  assert.equal(parseFrame(JSON.stringify({ corner: "middle", dx: 1, dy: 1, width: 300 })), null);
  assert.equal(parseFrame(JSON.stringify({ corner: "topRight", dx: 1, dy: 1, width: -4 })), null);
  assert.deepEqual(parseFrame(JSON.stringify({ corner: "topRight", dx: -3, dy: 4, width: 300 })), { corner: "topRight", dx: 0, dy: 4, width: 300 });
});

test("the player is kept inside the card while it is dragged", () => {
  assert.deepEqual(clampInto({ x: -50, y: 2000, width: 300, height: 169 }, area), { x: area.x + PLAYER_INSET, y: area.y + area.height - PLAYER_INSET - 169, width: 300, height: 169 });
});

test("a fling over 350 points per second throws it to the corner it heads for, within 45 degrees", () => {
  const rect = { x: 600, y: 300, width: 280, height: 158 };
  const pointer = { x: 700, y: 350 };
  assert.deepEqual(flingTarget(rect, pointer, { x: 900, y: -700 }, area), cornerRect("topRight", rect, area));
  assert.equal(flingTarget(rect, pointer, { x: 200, y: -100 }, area), null);
  assert.equal(flingTarget(rect, pointer, { x: 0, y: -900 }, area), null);
});

test("the throw spring settles on its target without overshooting more than a fraction of a point", () => {
  let axis = { position: 0, velocity: 0 };
  let peak = 0;
  let frames = 0;
  while (!springSettled(axis, 800) && frames < 600) {
    axis = springStep(axis, 800, 1 / 60);
    peak = Math.max(peak, axis.position);
    frames++;
  }
  assert.ok(frames < 120, `settled in ${frames} frames`);
  assert.ok(peak < 800 + 2, `peak ${peak}`);
});

test("edge and corner handles resize around the opposite side at the video's aspect ratio", () => {
  const start = { x: 600, y: 300, width: 320, height: 180 };
  assert.deepEqual(handleAt({ x: 602, y: 302 }, start), { x: -1, y: -1 });
  assert.deepEqual(handleAt({ x: 760, y: 478 }, start), { x: 0, y: 1 });
  assert.equal(handleAt({ x: 760, y: 390 }, start), null);
  const grown = resizeFrom(start, { x: 1, y: 1 }, { x: 80, y: 10 }, aspect, area);
  assert.equal(grown.x, 600);
  assert.equal(grown.y, 300);
  assert.equal(grown.width, 400);
  assert.equal(grown.height, 225);
  const fromLeft = resizeFrom(start, { x: -1, y: 0 }, { x: 80, y: 0 }, aspect, area);
  assert.equal(fromLeft.x + fromLeft.width, start.x + start.width);
  assert.equal(fromLeft.width, 240);
});

function tree(spec, parent = null) {
  const node = { name: spec.name, rect: spec.rect, paints: !!spec.paints, layer: !!spec.layer, parentElement: parent, children: [] };
  node.children = (spec.children ?? []).map((child) => tree(child, node));
  return node;
}

function find(node, name) {
  if (node.name === name) return node;
  for (const child of node.children) {
    const found = find(child, name);
    if (found) return found;
  }
  return null;
}

test("base UI under the player is clipped and overlays and their ancestors are not", () => {
  const root = tree({
    name: "desktop",
    rect: { x: 0, y: 0, width: 1400, height: 900 },
    children: [
      {
        name: "window",
        rect: { x: 0, y: 0, width: 1400, height: 900 },
        children: [
          { name: "player", rect: { x: 900, y: 600, width: 300, height: 169 } },
          { name: "backdrop", rect: { x: 0, y: 0, width: 1400, height: 900 }, layer: true },
          { name: "sidebar", rect: { x: 0, y: 0, width: 200, height: 900 }, paints: true },
          {
            name: "pane",
            paints: true,
            rect: { x: 200, y: 50, width: 1200, height: 850 },
            children: [
              { name: "newTab", rect: { x: 200, y: 100, width: 1200, height: 800 }, children: [{ name: "tile", rect: { x: 950, y: 650, width: 80, height: 80 }, paints: true }] },
              { name: "pageOverlays", rect: { x: 200, y: 100, width: 1200, height: 800 }, children: [{ name: "prompt", rect: { x: 1000, y: 620, width: 300, height: 120 }, paints: true }] },
            ],
          },
        ],
      },
    ],
  });
  const keep = [find(root, "player"), find(root, "prompt")];
  const plan = planHoles([root], { x: 900, y: 600, width: 300, height: 169 }, keep, {
    rectOf: (node) => node.rect,
    paints: (node) => node.paints,
    managed: (node) => node.layer,
    clippedElsewhere: () => false,
  });
  assert.deepEqual(plan.clip.map((node) => node.name).sort(), ["newTab"]);
  assert.deepEqual(plan.hosts.map((node) => node.name), ["pane"]);
});

test("a floating hole merges with page holes instead of cancelling them", () => {
  const page = { x: 200, y: 100, width: 1200, height: 800 };
  assert.deepEqual(floatingPieces({ rect: { x: 900, y: 600, width: 300, height: 169 }, radius: 6 }, [page]), []);
  const straddling = floatingPieces({ rect: { x: 900, y: 60, width: 300, height: 169 }, radius: 6 }, [page]);
  assert.equal(straddling.length, 1);
  assert.deepEqual(straddling[0].rect, { x: 900, y: 60, width: 300, height: 40 });
  assert.deepEqual(straddling[0].radii, [6, 6, 0, 0]);
  const path = holeClipPath({ width: 1400, height: 900 }, [page], 12, straddling);
  assert.match(path, /^path\(evenodd/);
  assert.equal(holeClipPath({ width: 10, height: 10 }, []), "");
});

test("engine player events are read defensively and stale leaves are recognised", () => {
  assert.equal(readPlayerEvent(null, 0), null);
  assert.equal(readPlayerEvent({ player: 0, active: true }, 0), null);
  const read = readPlayerEvent({ player: 4, active: true, playing: true, origin: "www.youtube.com", naturalWidth: 1920, naturalHeight: 1080, position: { current: 12, duration: 60, rate: 1 } }, 1000);
  assert.equal(read.state.player, 4);
  assert.deepEqual(read.state.natural, { width: 1920, height: 1080 });
  assert.deepEqual(read.state.position, { current: 12, duration: 60, rate: 1, at: 1000 });
  assert.deepEqual(readPlayerEvent({ player: 4, active: false, fade: 70 }, 0), { leaving: { player: 4, fade: 70 } });
});

test("the progress bar extrapolates playback from the last engine position", () => {
  const position = { current: 10, duration: 20, rate: 1, at: 1000 };
  assert.equal(positionAt(position, true, 3000), 12);
  assert.equal(positionAt(position, false, 3000), 10);
  assert.equal(positionAt(position, true, 100000), 20);
  assert.equal(positionAt(null, true, 0), null);
});
