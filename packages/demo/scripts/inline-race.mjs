#!/usr/bin/env node
// Types into the demo's command bar as fast as CDP can deliver keys and checks inline completion never corrupts
// the text (the 0.1 spike's "xkcd.comd.com/927").
//
//   node packages/demo/scripts/inline-race.mjs [--url http://127.0.0.1:5191/] [--runs 5]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sleep } from "../../../scripts/lib/instance.mjs";
import { startChrome } from "./chrome.mjs";

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
const runs = Number(option("runs", "5"));
const QUERIES = ["xkcd.com/927", "wikipedia.org/wiki/Hypertext", "react.dev/learn", "github.com"];

const { child, page } = await startChrome("inline-race-profile");
let failures = 0;
try {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let run = 0; run < runs; run++)
    for (const query of QUERIES) {
      await page.send("Page.navigate", { url: `${url}?bare&race=${Date.now()}` });
      for (let i = 0; i < 100 && !(await page.eval("!!globalThis.ardiaDemo").catch(() => false)); i++) await sleep(100);
      await sleep(800);
      await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "l", code: "KeyL", modifiers: 4, windowsVirtualKeyCode: 76 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "l", code: "KeyL", modifiers: 4 });
      await sleep(300);
      for (const ch of query) {
        void page.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
        void page.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      }
      await sleep(600);
      const state = await page.eval("(() => { const f = document.activeElement; return f && 'value' in f ? { value: f.value, start: f.selectionStart, end: f.selectionEnd } : null })()");
      const typed = state ? state.value.slice(0, state.start) : "";
      const ok = !!state && typed === query && state.value.startsWith(query);
      if (!ok) failures++;
      console.log(`${ok ? "ok  " : "FAIL"} ${query} -> ${JSON.stringify(state)}`);
    }
} finally {
  page.close();
  child.kill();
}
console.log(`${failures} failures in ${runs * QUERIES.length} runs`);
process.exit(failures ? 1 : 0);
