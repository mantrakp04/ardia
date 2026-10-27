#!/usr/bin/env node
const HELP = `Builds the onboarding intro's meadow from ardia.dev's hero scene.

  node scripts/meadow.mjs           write ios/Meadow (index.html, posters.json and the posters)
  node scripts/meadow.mjs --check   fail if ios/Meadow differs from what the site's sources build

The page runs apps/site/src/scripts/meadowApp.ts, which starts the site's own createMeadow and
startSunrise (apps/site/src/scripts/meadow), bundled inline so the pod ships one HTML file. The
posters are the site's desktop dawn and morning frames from apps/site/src/data/heroPoster.ts; the
native view shows the one nearest the window's shape until the scene's first frame.`;

import { build } from "esbuild";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}
const check = args.includes("--check");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const site = join(repo, "apps/site/src");
const out = fileURLToPath(new URL("../ios/Meadow/", import.meta.url));
const posterDir = join(site, "assets/hero");
const DESKTOP_FRAMES = new Set(["wider", "wide", "laptop", "mid"]);

async function bundle(entry, options) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    logLevel: "silent",
    legalComments: "none",
    tsconfigRaw: { compilerOptions: { target: "ESNext", verbatimModuleSyntax: true, strict: true } },
    ...options,
  });
  return result.outputFiles[0].text;
}

async function heroPosters() {
  const globShim = join(mkdtempSync(join(tmpdir(), "meadow-")), "glob.mjs");
  writeFileSync(
    globShim,
    `export const __glob = () => Object.fromEntries(${JSON.stringify(readdirSync(posterDir).filter((file) => file.endsWith(".webp")))}.map((file) => ["../assets/hero/" + file, file]));\n`,
  );
  const code = await bundle(join(site, "data/heroPoster.ts"), { format: "esm", platform: "node", define: { "import.meta.glob": "__glob" }, inject: [globShim] });
  const module = join(globShim, "../heroPoster.mjs");
  writeFileSync(module, code);
  const { HERO_POSTERS } = await import(pathToFileURL(module).href);
  rmSync(join(globShim, ".."), { recursive: true, force: true });
  return HERO_POSTERS.map((poster) => {
    const [state, frame] = poster.key.split("-");
    return { state, frame, file: poster.src, aspect: poster.width / poster.height, horizon: Number.parseFloat(poster.horizon) / 100 };
  }).filter((poster) => DESKTOP_FRAMES.has(poster.frame));
}

const STYLE = `html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}
.hero{position:absolute;inset:0;overflow:hidden}
.meadow-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.hero-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.hero-title{display:flex;flex-direction:column;align-items:center;gap:18px;margin:0;color:transparent;font-family:-apple-system,system-ui,sans-serif;font-weight:normal}
.line{display:block}
.line>span{display:block}
.icon{width:96px;height:96px}
.wordmark{font-size:64px;font-weight:200;letter-spacing:-1.5px}
.tagline{font-size:17px;font-weight:300}`;

function page(script) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>${STYLE}</style>
</head>
<body aria-hidden="true">
<section class="hero" data-meadow>
<canvas class="meadow-canvas" data-meadow-canvas></canvas>
<div class="hero-text"><div class="hero-title"><span class="line"><span class="icon"></span></span><span class="line"><span class="wordmark">Ardia</span></span><span class="line"><span class="tagline">Your new home on the internet</span></span></div></div>
</section>
<script>${script.trim()}</script>
</body>
</html>
`;
}

async function generate() {
  const script = await bundle(join(site, "scripts/meadowApp.ts"), {
    format: "iife",
    platform: "browser",
    target: "safari17",
    minify: true,
    define: { "import.meta.env.DEV": "false" },
  });
  const posters = await heroPosters();
  const files = new Map([
    ["index.html", Buffer.from(page(script))],
    ["posters.json", Buffer.from(`${JSON.stringify(posters, null, 2)}\n`)],
  ]);
  for (const poster of posters) files.set(poster.file, readFileSync(join(posterDir, poster.file)));
  return files;
}

const files = await generate();
if (check) {
  const present = (() => {
    try {
      return readdirSync(out);
    } catch {
      return [];
    }
  })();
  const stale = [...files].filter(([name, bytes]) => {
    try {
      return !readFileSync(join(out, name)).equals(bytes);
    } catch {
      return true;
    }
  });
  const extra = present.filter((name) => !files.has(name));
  if (stale.length || extra.length) {
    console.error(`packages/shaders/ios/Meadow is out of date (${[...stale.map(([name]) => name), ...extra].join(", ")}): run node packages/shaders/scripts/meadow.mjs`);
    process.exit(1);
  }
  console.log(`✓ ios/Meadow matches the site's meadow (${files.size} files)`);
} else {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const [name, bytes] of files) writeFileSync(join(out, name), bytes);
  console.log(`wrote ${files.size} files to packages/shaders/ios/Meadow`);
}
