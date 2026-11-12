#!/usr/bin/env node
// Captures the demo in reference.mjs's states with headless Chromium at 2x and compares each region with the
// real app's captures: side-by-side, diff heatmap and onion-skin images, plus edge offsets, flat-fill ΔE and text
// baseline/size/weight numbers.
//
//   node packages/demo/scripts/compare.mjs [--url http://127.0.0.1:5191/] [--ref DIR] [--out DIR]
//                                      [--themes light,dark] [--states idle,command,...] [--regions sidebar,...]
//                                      [--no-capture] [--json]
//
// Needs the reference captures (reference.mjs) and a running demo (the Vite dev server or `vite preview`).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "../../../scripts/lib/instance.mjs";
import { startChrome } from "./chrome.mjs";
import { loadSeed } from "./seedSession.mjs";
import { COMMAND_QUERY, DEMO_WINDOW, demoLayoutScript, fieldScript, HOVER_ROW, newTabScript, profileScript, resetScript, STATES, THEMES, VIEWPORT, WINDOW_INSET } from "./states.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = realpathSync("/tmp") + "/ardia-demo-layout";
const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = option("url", "http://127.0.0.1:5191/");
const ref = resolve(option("ref", `${scratch}/ref`));
const out = resolve(option("out", `${scratch}/compare`));
const themes = option("themes", THEMES.join(",")).split(",");
const states = option("states", STATES.join(",")).split(",");
const regions = option("regions", "");

const seed = await loadSeed();
const reset = resetScript("ardiaDemo.store", seed.seedTabs());
const run = (page, body) => page.eval(`(() => { ${body} })()`);

async function key(page, key, { meta = false } = {}) {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const modifiers = meta ? 4 : 0;
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, modifiers, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
}

async function typeText(page, text) {
  for (const ch of text) {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await sleep(45);
  }
}

const mouse = (page, x, y, type = "mouseMoved", extra = {}) =>
  page.send("Input.dispatchMouseEvent", { type, x: WINDOW_INSET.left + x, y: WINDOW_INSET.top + y, ...extra });

const setups = {
  idle: async () => {},
  command: async (page) => {
    await key(page, "l", { meta: true });
    await sleep(300);
    await typeText(page, COMMAND_QUERY);
  },
  ntp: (page) => run(page, newTabScript("ardiaDemo.store")),
  hover: (page) => mouse(page, HOVER_ROW.x, HOVER_ROW.y),
  menu: async (page) => {
    await mouse(page, 100, 209, "mousePressed", { button: "right", clickCount: 1 });
    await mouse(page, 100, 209, "mouseReleased", { button: "right", clickCount: 1 });
  },
  profile: (page) => run(page, profileScript("ardiaDemo.store")),
  field: (page) => run(page, fieldScript("ardiaDemo.store")),
};

async function captureDemo() {
  const { child, page } = await startChrome();
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 2, mobile: false });
    for (const theme of themes) {
      await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
      mkdirSync(join(out, theme), { recursive: true });
      for (const state of states) {
        await page.send("Page.navigate", { url: `${url}${url.includes("?") ? "&" : "?"}bare&compare=${Date.now()}` });
        for (let i = 0; i < 100 && !(await page.eval("!!globalThis.ardiaDemo && document.readyState === 'complete'").catch(() => false)); i++) await sleep(100);
        await page.eval("document.fonts.ready.then(() => true)");
        await run(page, reset);
        for (let i = 0; i < 100 && (await run(page, "const s = ardiaDemo.store.getState(); return !!s.live.t_browser?.isLoading;")); i++) await sleep(100);
        await mouse(page, -10, -10);
        await sleep(700);
        await setups[state](page);
        await sleep(state === "profile" ? 1500 : 900);
        const shot = await page.send("Page.captureScreenshot", {
          format: "png",
          clip: { x: WINDOW_INSET.left, y: WINDOW_INSET.top, width: DEMO_WINDOW.width, height: DEMO_WINDOW.height, scale: 1 },
          captureBeyondViewport: false,
        });
        writeFileSync(join(out, theme, `${state}.demo.png`), Buffer.from(shot.data, "base64"));
        writeFileSync(join(out, theme, `${state}.demo.layout.json`), JSON.stringify(await run(page, demoLayoutScript(WINDOW_INSET))));
      }
    }
  } finally {
    page.close();
    child.kill();
  }
}

if (!args.includes("--no-capture")) await captureDemo();
const analysis = spawnSync("python3", [join(here, "analyze.py"), ref, out, themes.join(","), states.join(","), regions], { stdio: "inherit" });
process.exit(analysis.status ?? 1);
