import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const scratch = process.env.FIXES_SCRATCH ?? join(process.env.HOME, "ardia-scratch/video-fixes");
await import("./extensions.mjs");
const dir = join(scratch, "ext", "color-picker-shortcut");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "Color Picker",
  version: "1.0",
  description: "Picks a colour from the page.",
  action: { default_popup: "popup.html", default_icon: "icon.png" },
  icons: { 128: "icon.png" },
  commands: { _execute_action: { suggested_key: { default: "Ctrl+Shift+K", mac: "MacCtrl+Shift+K" } } },
}));
writeFileSync(join(dir, "popup.html"), `<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:-apple-system,system-ui,sans-serif;font-size:14px;padding:16px 18px;width:200px;color:#1d1b18"><div style="font-weight:650;font-size:15px">Color Picker</div><div style="display:flex;align-items:center;gap:10px;margin-top:12px"><span style="width:26px;height:26px;border-radius:7px;background:#3478F6"></span><span style="font-family:ui-monospace,Menlo,monospace">#3478F6</span></div></body>`);
writeFileSync(join(dir, "icon.png"), readFileSync(join(scratch, "ext", "color-picker", "icon.png")));

const small = `const S = globalThis.__small; const f = st().windows[S].frame; return C.chromeWindows().then((ws) => ws.find((w) => { const r = w.frame.match(/[-\\d.]+/g).map(Number); return w.hasRoot && Math.abs(r[0] - f[0]) < 2 && Math.abs(r[2] - f[2]) < 2; }).window)`;

export default {
  setup: `st().activate("t3"); const X = globalThis.expo.modules.ArdiaExtensions; return X.install(${JSON.stringify(dir)}, "").then((r) => ac.extensions.refreshExtensions("").then(() => sleep(2000)).then(() => { globalThis.__small = st().createWindow({ small: true, url: "http://moodwall.example/" }); return sleep(3000); }).then(() => done({ installed: r, small: globalThis.__small, frame: st().windows[globalThis.__small].frame })));`,
  act: `const smallWindow = () => { ${small}; }; return sleep(700).then(smallWindow).then((n) => { mark("go"); mark("⌃⇧K"); return C.devWindow(n, "keys:" + (262144 + SHIFT) + ":k:40"); }).then(() => sleep(3400)).then(() => done({ popup: ac.extensions.useExtensions.getState().popup }));`,
};
