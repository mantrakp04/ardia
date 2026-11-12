import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { play, Script } from "../input.mjs";

const HOME = process.env.HOME;
const SCRATCH = process.env.FIXES_SCRATCH ?? join(HOME, "ardia-scratch/video-fixes");
const SUPPORT = join(HOME, "ardia-scratch/zen/home117/Library/Application Support");
const IMPORT = "Import from Another Browser";
const CONTINUE = [582, 572];
const FINISH = [561, 572];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = promisify(execFile);

const importWindow = (pid) => JSON.parse(execFileSync(join(SCRATCH, "winbounds"), [String(pid)], { encoding: "utf8" })).find((w) => w.title === IMPORT && w.w > 100);

function recordImport(pid, side) {
  const dir = join(SCRATCH, "runs", `n7zen-import-${side}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const shots = [];
  let stop = false;
  let window = null;
  const loop = (async () => {
    for (const end = Date.now() + 10000; !window && Date.now() < end; await sleep(50)) window = importWindow(pid) ?? null;
    if (!window) throw new Error("the import window never opened");
    while (!stop) {
      const t = Date.now();
      const file = join(dir, `${shots.length}.png`);
      try {
        await run("screencapture", ["-x", "-o", `-l${window.id}`, file], { timeout: 5000 });
        shots.push({ t, file });
      } catch {
        break;
      }
    }
  })();
  return {
    stop: async () => {
      stop = true;
      await loop;
      const out = join(SCRATCH, "footage", side, "n7zen-import.mov");
      const list = shots.map((s, i) => `file '${s.file}'\nduration ${((shots[i + 1]?.t ?? s.t + 500) - s.t) / 1000}`).join("\n") + `\nfile '${shots.at(-1).file}'\n`;
      writeFileSync(join(dir, "list.txt"), list);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", out]);
      return { t0: shots[0].t, rect: [window.x, window.y, window.w, window.h] };
    },
  };
}

export default {
  session: "session-0246n7-basic.json",
  instance: { importSourceDir: SUPPORT },
  setup: `return sleep(2500).then(() => done({ profiles: st().profileOrder.length }));`,
  external: async (instance, side) => {
    const rec = recordImport(instance.pid, side);
    const s = new Script(IMPORT);
    s.wait(3400).move(...CONTINUE, 500).wait(250).click();
    if (side === "after") s.wait(2600).move(CONTINUE[0] - 2, CONTINUE[1], 200).wait(400).click();
    s.wait(side === "after" ? 5200 : 7800).move(...FINISH, 400).wait(250).click().wait(200);
    const events = await play(instance, s);
    let closed = null;
    for (const end = Date.now() + 5000; !closed && Date.now() < end; await sleep(50)) if (!importWindow(instance.pid)) closed = Date.now();
    const { t0, rect } = await rec.stop();
    return [...events, { t: t0, overlay: { file: "n7zen-import", rect } }, { t: closed ?? Date.now(), overlayEnd: 1 }];
  },
  act: `const others = () => st().profileOrder.filter((p) => p !== "default");
return sleep(1200).then(() => { mark("go"); ac.runCommand({ command: "importBrowserData", arg: null, windowId: W }); return sleep(15600); })
  .then(() => { mark("profile"); const o = others(); if (o.length) st().switchProfile(W, o[0]); return sleep(3600); })
  .then(() => done({ profiles: st().profileOrder.map((p) => st().profiles[p].name), tabs: Object.values(st().tabs).map((t) => [t.profileId, t.pinned ? 1 : 0, t.url]) }));`,
  tail: 400,
};
