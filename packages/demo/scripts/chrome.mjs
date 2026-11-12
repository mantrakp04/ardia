import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { devtools, freePort, sleep } from "../../../scripts/lib/instance.mjs";

export function chromeBinary() {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const dirs = existsSync(cache) ? spawnSync("ls", [cache], { encoding: "utf8" }).stdout.split("\n").filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
  for (const dir of dirs.reverse()) {
    const binary = join(cache, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (existsSync(binary)) return binary;
  }
  throw new Error("no Chrome for Testing under ~/Library/Caches/ms-playwright");
}

export async function startChrome(name = "chrome-profile") {
  const port = await freePort();
  const profile = `${realpathSync("/tmp")}/ardia-demo-layout/${name}`;
  rmSync(profile, { recursive: true, force: true });
  const child = spawn(chromeBinary(), [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--force-device-scale-factor=2", "--no-first-run",
    "--no-default-browser-check", "--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none",
    "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return { child, page: await devtools(page, { name: "demo" }) };
    } catch {}
    await sleep(100);
  }
  child.kill();
  throw new Error("headless Chromium didn't start");
}
