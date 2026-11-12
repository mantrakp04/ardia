import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { prepareApp } from "../../../scripts/lib/app-copy.mjs";
import { launch, session } from "../../../scripts/lib/instance.mjs";

const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: { bundle: { type: "string" }, out: { type: "string" }, port: { type: "string" } } });
if (!positionals[0]) {
  console.error("usage: node capture-test.mjs <Ardia.app> [--bundle <main.jsbundle>] [--out <dir>]");
  process.exit(2);
}
const out = resolve(flags.out ?? join(tmpdir(), "ac-capture"));
mkdirSync(out, { recursive: true });
const app = flags.bundle ? prepareApp(positionals[0], join(out, "app"), { bundle: resolve(flags.bundle) }) : resolve(positionals[0]);
const dataDir = join(out, "data");

const html = `<title>Capture</title><style>html,body{margin:0;background:rgb(255,255,255)}
#card{position:absolute;left:100px;top:80px;width:300px;height:200px;background:rgb(220,0,0)}
#pic{position:absolute;left:20px;top:20px;width:160px;height:120px;display:block}
p{margin:0}</style><div id=card><canvas id=pic width=160 height=120></canvas></div>
<script>const c=document.getElementById('pic').getContext('2d');c.fillStyle='rgb(0,0,220)';c.fillRect(0,0,160,120)</script>`;
const page = `data:text/html,${encodeURIComponent(html)}`;
const other = `data:text/html,${encodeURIComponent("<title>Other</title><p>other</p>")}`;
const tall = `data:text/html,${encodeURIComponent("<title>Tall</title><style>html,body{margin:0}div{height:1000px}</style><div style='background:rgb(220,0,0)'></div><div style='background:rgb(0,160,0)'></div><div style='background:rgb(0,0,220)'></div>")}`;

const instance = await launch(app, {
  data: dataDir,
  fresh: true,
  port: flags.port,
  onboarded: true,
  probe: true,
  session: session({
    windows: [{ id: "w1", frame: [100, 100, 1100, 760] }],
    tabs: [
      { id: "a", url: page, title: "Capture" },
      { id: "b", url: other, title: "Other" },
      { id: "c", url: tall, title: "Tall" },
    ],
    settings: { searchSuggestions: false, warnBeforeClosingLastTab: false, warnBeforeClosingWindow: false },
  }),
  ready: { timeout: 120_000, test: "return !!ac.store.getState().windows.w1;" },
});
const ac = (body, ms = 60_000) => instance.eval(body, { timeout: ms });
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};

const pasteboardNames = [...new Set([dataDir, realpathSync(dataDir)].flatMap((dir) => [dir, dir.replace(/^\/private\//, "/")]))].map((dir) => `com.ardia.scratch:${dir}`);
const pngPath = join(out, "clipboard.png");
function readPasteboard() {
  rmSync(pngPath, { force: true });
  const script = `ObjC.import("AppKit");
    const names = ${JSON.stringify(pasteboardNames)};
    let found = "none";
    for (const name of names) {
      const board = $.NSPasteboard.pasteboardWithName(name);
      const data = board.dataForType("public.png");
      if (data && !data.isNil()) {
        data.writeToFileAtomically(${JSON.stringify(pngPath)}, true);
        const rep = $.NSBitmapImageRep.imageRepWithData(data);
        const pick = (fx, fy) => {
          const color = rep.colorAtXY(Math.floor(Number(rep.pixelsWide) * fx), Math.floor(Number(rep.pixelsHigh) * fy));
          return [color.redComponent, color.greenComponent, color.blueComponent].map((v) => Math.round(v * 255));
        };
        found = JSON.stringify({ count: Number(board.changeCount), space: rep.colorSpace.localizedName.js, width: Number(rep.pixelsWide), height: Number(rep.pixelsHigh), center: pick(0.5, 0.5), corner: pick(0.97, 0.97) });
        break;
      }
      found = JSON.stringify({ count: Number(board.changeCount) });
    }
    found;`;
  return JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e", script], { encoding: "utf8" }).trim());
}

const near = (rgb, want) => rgb && rgb.every((v, i) => Math.abs(v - want[i]) <= 12);

try {
  await ac(`
    globalThis.audit = {
      frames: (n) => new Promise((r) => { let k = n || 2; const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }),
      until: (test, ms) => new Promise((r) => { const end = Date.now() + (ms || 15000); const poll = () => (test() ? r(true) : Date.now() > end ? r(false) : setTimeout(poll, 50)); poll(); }),
      toast: () => ac.toasts.getState().toasts.w1 || null,
      clear: () => ac.toasts.setState({ toasts: {} }),
      start: () => { audit.clear(); return ac.shell.devMenuCommand("capture", null).then(() => new Promise((r) => setTimeout(r, 600))); },
      settle: (ms) => new Promise((r) => setTimeout(r, ms || 600)),
      key: (keyCode, key) => ac.shell.devKeyEquivalent("w1", { key, keyCode, send: true, asKey: true, wait: 150 }),
    };
    return true;`);
  const S = "const S = () => ac.store.getState();";
  const loaded = await ac(`${S} S().activate("a"); return audit.until(() => S().tabs.a.title === "Capture" && ac.webviews.has("a"), 30000).then((ok) => audit.settle(800).then(() => ok));`);
  check("the test page is up", loaded === true);
  const scale = await ac(`return ac.webviews.get("a").evaluate("post('result', JSON.stringify(devicePixelRatio))");`);

  const hovered = await ac(`return audit.start()
    .then(() => ac.shell.devPointer("w1", [{ type: "move", x: 200, y: 160, wait: 500 }, { type: "down", x: 200, y: 160 }, { type: "up", x: 200, y: 160, wait: 600 }]))
    .then((r) => ({ responder: r.firstResponder, toast: audit.toast() }));`);
  const shotA = readPasteboard();
  check("hover then click copies the canvas under the pointer", hovered.toast?.title === "Capture copied" && shotA.width === 160 * scale && shotA.height === 120 * scale, `${JSON.stringify(hovered.toast)} ${shotA.width}×${shotA.height} @${scale}x`);
  check("the copy is the page's pixels in sRGB (blue canvas)", shotA.space === "sRGB IEC61966-2.1" && near(shotA.center, [0, 0, 220]), `${shotA.space} ${JSON.stringify(shotA.center)}`);

  const clickOnly = await ac(`return audit.start()
    .then(() => ac.shell.devPointer("w1", [{ type: "down", x: 360, y: 260 }, { type: "up", x: 360, y: 260, wait: 800 }]))
    .then(() => audit.toast());`);
  const shotB = readPasteboard();
  check("a click with no hover first still takes the block under it", clickOnly?.title === "Capture copied" && shotB.width === 300 * scale && shotB.height === 200 * scale, `${shotB.width}×${shotB.height}`);
  check("that block is the red card", near(shotB.corner, [220, 0, 0]), JSON.stringify(shotB.corner));

  const quick = await ac(`return audit.start()
    .then(() => ac.shell.devPointer("w1", [{ type: "move", x: 200, y: 160, wait: 0 }, { type: "down", x: 360, y: 260, wait: 0 }, { type: "up", x: 360, y: 260, wait: 900 }]))
    .then(() => audit.toast());`);
  const shotQ = readPasteboard();
  check("a quick click on another block, while the last lookup is still out, takes the clicked block", quick?.title === "Capture copied" && shotQ.width === 300 * scale && near(shotQ.corner, [220, 0, 0]), `${shotQ.width}×${shotQ.height} ${JSON.stringify(shotQ.corner)}`);

  const stepped = await ac(`return audit.start()
    .then(() => ac.shell.devPointer("w1", [{ type: "move", x: 200, y: 160, wait: 500 }]))
    .then(() => audit.key(126, "\\uf700"))
    .then((up) => audit.settle(200).then(() => audit.key(36, "\\r")).then((enter) => audit.settle(600).then(() => ({ up, enter, toast: audit.toast() }))));`);
  console.log("     keys:", JSON.stringify(stepped));
  const shotC = readPasteboard();
  check("↑ steps out from the canvas to the card, Return takes it", stepped.toast?.title === "Capture copied" && shotC.width === 300 * scale && shotC.height === 200 * scale, `${shotC.width}×${shotC.height}`);

  const dragged = await ac(`return audit.start()
    .then(() => ac.shell.devPointer("w1", [
      { type: "down", x: 30, y: 330 }, { type: "drag", x: 80, y: 360 }, { type: "drag", x: 160, y: 400 }, { type: "drag", x: 230, y: 430 }, { type: "up", x: 230, y: 430, wait: 600 },
    ]))
    .then((pointer) => ({ pointer, toast: audit.toast() }));`);
  const shotD = readPasteboard();
  console.log("     drag:", JSON.stringify(dragged));
  check("a drag copies exactly the dragged area", dragged.toast?.title === "Capture copied" && shotD.width === 200 * scale && shotD.height === 100 * scale, `${shotD.width}×${shotD.height}`);
  check("the dragged area is the white page", near(shotD.center, [255, 255, 255]), JSON.stringify(shotD.center));

  const before = readPasteboard().count;
  const escaped = await ac(`return audit.start()
    .then(() => audit.key(53, "\\u001b"))
    .then(() => audit.settle(400))
    .then(() => ac.shell.devPointer("w1", [{ type: "down", x: 360, y: 260 }, { type: "up", x: 360, y: 260, wait: 600 }]))
    .then(() => audit.toast());`);
  check("Esc leaves without copying, and the next click is the page's", escaped === null && readPasteboard().count === before, JSON.stringify(escaped));

  const toggled = await ac(`return audit.start()
    .then(() => ac.shell.devMenuCommand("capture", null))
    .then(() => audit.settle(400))
    .then(() => ac.shell.devPointer("w1", [{ type: "down", x: 360, y: 260 }, { type: "up", x: 360, y: 260, wait: 600 }]))
    .then(() => audit.toast());`);
  check("⇧⌘2 again leaves without copying", toggled === null && readPasteboard().count === before, JSON.stringify(toggled));

  const switched = await ac(`${S} return audit.start()
    .then(() => { S().activate("b"); return audit.settle(400); })
    .then(() => { S().activate("a"); return audit.settle(600); })
    .then(() => ac.shell.devPointer("w1", [{ type: "down", x: 360, y: 260 }, { type: "up", x: 360, y: 260, wait: 600 }]))
    .then(() => audit.toast());`);
  check("showing another tab ends it", switched === null && readPasteboard().count === before, JSON.stringify(switched));

  const paint = (color) => `ac.webviews.get("a").evaluate("document.getElementById('card').style.background = '${color}'; post('result', 'true')")`;
  const repainted = await ac(`return audit.start()
    .then(() => ${paint("rgb(0,160,0)")})
    .then(() => audit.settle(400))
    .then(() => ac.shell.devPointer("w1", [{ type: "down", x: 360, y: 260 }, { type: "up", x: 360, y: 260, wait: 900 }]))
    .then(() => { const t = audit.toast(); return ${paint("rgb(220,0,0)")}.then(() => audit.settle(300)).then(() => t); });`);
  const shotR = readPasteboard();
  check("a clicked block is copied as it is now, not as it was when Capture froze the page", repainted?.title === "Capture copied" && near(shotR.corner, [0, 160, 0]), JSON.stringify(shotR.corner));

  const saved = await ac(`return audit.start()
    .then(() => ac.shell.devPointer("w1", [{ type: "down", x: 360, y: 260 }, { type: "up", x: 360, y: 260, wait: 800 }]))
    .then(() => { const t = audit.toast(); t && t.action && t.action.run(); return audit.until(() => audit.toast()?.title === "Capture saved", 5000); })
    .then(() => audit.toast());`);
  check("Save writes the capture to the downloads folder", saved?.title === "Capture saved" && /^Capture .+\.png$/.test(saved.message ?? ""), JSON.stringify(saved));

  const full = await ac(`${S} S().activate("c");
    return audit.until(() => S().tabs.c.title === "Tall" && ac.webviews.has("c"), 20000)
      .then(() => audit.settle(800))
      .then(() => ac.webviews.get("c").evaluate("post('result', JSON.stringify([document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerHeight]))"))
      .then((size) => { audit.clear(); return ac.shell.devMenuCommand("captureFullPage", null).then(() => audit.until(() => audit.toast()?.title === "Capture copied", 20000)).then(() => ({ size, toast: audit.toast() })); });`);
  const shotE = readPasteboard();
  const [pageWidth, pageHeight, shownHeight] = full.size ?? [];
  check("Capture Full Page copies the whole page, past the window", full.toast?.title === "Capture copied" && shownHeight < pageHeight && shotE.width === pageWidth * scale && shotE.height === pageHeight * scale, `${shotE.width}×${shotE.height} for a ${pageWidth}×${pageHeight} page in a ${shownHeight} pt window`);
  check("its middle and bottom are the page's (green, blue)", near(shotE.center, [0, 160, 0]) && near(shotE.corner, [0, 0, 220]), `${JSON.stringify(shotE.center)} ${JSON.stringify(shotE.corner)}`);
} finally {
  await instance.quit();
}
process.exit(results.every(Boolean) ? 0 : 1);
