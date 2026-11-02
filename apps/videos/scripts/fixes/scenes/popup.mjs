import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = process.env.FIXES_SCRATCH ?? join(process.env.HOME, "ardia-scratch/video-fixes");
const recorder = join(scratch, "rec-window");
if (!existsSync(recorder)) spawnSync("swiftc", ["-O", "-o", recorder, join(here, "..", "rec-window.swift")], { stdio: "inherit" });

function recordPopup(instance, side) {
  const file = "popup-window";
  const child = spawn(recorder, [String(instance.pid), "7", join(scratch, "footage", side, `${file}.mov`), "Sign in"], { stdio: ["ignore", "pipe", "inherit"] });
  let text = "";
  child.stdout.on("data", (d) => (text += d));
  return new Promise((resolve) => {
    child.on("exit", () => {
      const m = /recording (\d+)/.exec(text);
      const r = /rect (-?\d+),(-?\d+),(\d+),(\d+) scale ([\d.]+)/.exec(text);
      resolve(m && r ? [{ t: Number(m[1]), overlay: { file, rect: r.slice(1, 5).map(Number), scale: Number(r[5]) } }] : []);
    });
  });
}

async function clickThroughPage(instance, side) {
  const recording = recordPopup(instance, side);
  await new Promise((r) => setTimeout(r, 1450));
  const page = await instance.page("signin.example");
  await page.eval(`document.getElementById("go").click(), 1`, { userGesture: true });
  page.close();
  return recording;
}

export default {
  session: "session-signin.json",
  setup: `return sleep(1500).then(() => done());`,
  external: clickThroughPage,
  act: `return at(1000, 700).then(() => sleep(300)).then(() => move(771, 487, 800)).then(() => sleep(300)).then(() => { mark("go"); events.push({ t: Date.now(), down: 1 }); return sleep(90).then(() => events.push({ t: Date.now(), up: 1 })); }).then(() => sleep(400)).then(() => { hide(); return sleep(3200); }).then(() => done());`,
  tail: 300,
};
