import { defineConfig } from "astro/config";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { constants, gzipSync } from "node:zlib";

function demo() {
  const demoDir = fileURLToPath(new URL("../../packages/demo/", import.meta.url));
  const demoVite = () => import(pathToFileURL(createRequire(join(demoDir, "package.json")).resolve("vite")).href);
  const demoConfig = (demoBase) => ({ configFile: join(demoDir, "vite.config.ts"), root: demoDir, base: demoBase, clearScreen: false });
  let demoBase = "/demo/";
  let demoServer;
  return {
    name: "ardia:demo",
    hooks: {
      "astro:config:done": ({ config }) => {
        demoBase = `${config.base.replace(/\/?$/, "/")}demo/`;
      },
      "astro:server:setup": async ({ server, logger }) => {
        const { createServer } = await demoVite();
        demoServer = await createServer({
          ...demoConfig(demoBase),
          logLevel: "warn",
          server: { middlewareMode: true, hmr: { server: server.httpServer, path: "__demo_hmr" } },
        });
        const bare = demoBase.slice(0, -1);
        server.middlewares.use((req, res, next) => {
          const path = req.url?.split("?")[0];
          if (path === bare || path?.startsWith(demoBase)) demoServer.middlewares(req, res, next);
          else next();
        });
        logger.info(`demo served from ${demoBase}`);
      },
      "astro:server:done": async () => {
        await demoServer?.close();
        demoServer = undefined;
      },
      "astro:build:done": async ({ dir, logger }) => {
        const { build } = await demoVite();
        const outDir = fileURLToPath(new URL("demo/", dir));
        await build({ ...demoConfig(demoBase), logLevel: "warn", build: { outDir, emptyOutDir: true } });
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
