import { defineConfig } from "astro/config";
import { execFileSync, spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, gzipSync } from "node:zlib";

function demo() {
  let base = "/";
  let devServer;
  const demoDir = fileURLToPath(new URL("../demo/", import.meta.url));
  const stopDevServer = () => {
    devServer?.kill();
    devServer = undefined;
  };
  return {
    name: "ardia:demo",
    hooks: {
      "astro:config:done": ({ config }) => {
        base = config.base.endsWith("/") ? config.base : `${config.base}/`;
      },
      "astro:server:setup": ({ logger }) => {
        if (process.env.PUBLIC_DEMO_URL || devServer) return;
        devServer = spawn("pnpm", ["-C", demoDir, "exec", "vite", "--logLevel", "warn"], { stdio: ["ignore", "inherit", "inherit"] });
        devServer.on("exit", (code) => {
          if (code) logger.warn("the demo dev server exited; if 127.0.0.1:5191 is already serving it, that one is used");
          devServer = undefined;
        });
        process.once("exit", stopDevServer);
        logger.info("demo dev server on http://127.0.0.1:5191/");
      },
      "astro:server:done": stopDevServer,
      "astro:build:done": ({ dir, logger }) => {
        const outDir = fileURLToPath(new URL("demo/", dir));
        execFileSync("pnpm", ["-C", demoDir, "exec", "vite", "build", "--base", `${base}demo/`, "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], { stdio: "inherit" });
        logger.info(`built the demo into ${outDir}`);
      },
    },
  };
}

function dist() {
  const compressible = /\.(html|css|js|mjs|json|svg|xml|txt)$/;
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return {
    name: "ardia:dist",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        let files = 0;
        for (const path of walk(fileURLToPath(dir)).filter((p) => compressible.test(p))) {
          const raw = readFileSync(path);
          const gz = gzipSync(raw, { level: constants.Z_BEST_COMPRESSION, memLevel: 9 });
          if (gz.length > raw.length * 0.95) continue;
          writeFileSync(`${path}.gz`, gz);
          files++;
        }
        logger.info(`gzipped ${files} files`);
      },
    },
  };
}

export default defineConfig({
  site: process.env.SITE_URL ?? "https://ardia.dev",
  base: process.env.SITE_BASE ?? "/",
  output: "static",
  trailingSlash: "ignore",
  build: { inlineStylesheets: "always", assets: "_assets" },
  image: { responsiveStyles: false },
  devToolbar: { enabled: false },
  integrations: [demo(), dist()],
});
