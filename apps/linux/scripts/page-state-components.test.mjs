import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const shared = fileURLToPath(new URL("../../browser/src/components/site/SiteConnection.tsx", import.meta.url));
const adapter = `${root}src/SiteConnection.tsx`;
const store = fileURLToPath(new URL("../../browser/src/state/browser/store.ts", import.meta.url));

test("production Linux SiteConnection replacement reaches real SiteControls and only delegates original through wrapper", { timeout: 60000 }, async () => {
  let graph;
  await build({ root, configFile: `${root}vite.config.ts`, logLevel: "error", build: { write: false }, plugins: [{
    name: "ardia-linux:test-page-state-graph",
    generateBundle() { graph = new Map([...this.getModuleIds()].map((id) => [id, this.getModuleInfo(id)])); },
  }] });
  assert.ok(graph.has(adapter));
  assert.deepEqual(graph.get(shared).importers, [adapter]);
  assert.ok(graph.get(adapter).importedIds.includes(shared));
  const consumer = fileURLToPath(new URL("../../browser/src/components/site/SiteControls.tsx", import.meta.url));
  assert.ok(graph.get(consumer).importedIds.includes(adapter));
  assert.deepEqual([...graph.keys()].filter((id) => id.includes("/apps/demo/")), []);
  const pageState = fileURLToPath(new URL("../../browser/src/state/tabs/pageState.ts", import.meta.url));
  const webView = `${root}src/shims/ardiacore.tsx`;
  const seen = new Set([webView]);
  for (const queue = [webView]; queue.length;) for (const next of graph.get(queue.shift())?.importedIds ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  assert.ok(!seen.has(pageState), "the WebView shim must not statically reach shared page state");
});

test("actual Linux connection wrapper renders unknown honestly and delegates every known state and certificate details", { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "ardia-site-connection-"));
  const entry = `${root}scripts/.page-state-entry-${process.pid}.tsx`;
  try {
    await writeFile(entry, `import ${JSON.stringify(store)};\nimport {createElement} from "react";\nimport {renderToStaticMarkup} from "react-dom/server";\nimport * as linux from ${JSON.stringify(adapter)};\nimport * as shared from ${JSON.stringify(shared)};\nexport {linux,shared};\nexport const render=(kind,security)=>renderToStaticMarkup(createElement(linux[kind],{security,open:false,onPress:()=>{}}));\n`);
    await build({ root, configFile: `${root}vite.config.ts`, logLevel: "error", ssr: { noExternal: true }, build: { ssr: entry, outDir: directory, emptyOutDir: false, minify: false, rollupOptions: { output: { entryFileNames: "fixture.mjs" } } } });
    const fixture = await import(pathToFileURL(join(directory, "fixture.mjs")).href);
    assert.equal(fixture.linux.CertificateDetails, fixture.shared.CertificateDetails);
    for (const security of [null, { level: "none", url: "https://unknown.test", origin: null }]) {
      for (const kind of ["ConnectionChip", "ConnectionRow"]) {
        const html = fixture.render(kind, security);
        assert.match(html, /Connection information unavailable/);
        assert.doesNotMatch(html, /Local Page|local or internal/);
      }
    }
    for (const [level, label] of [["secure", "Secure"], ["local", "Local Page"], ["mixed", "Not Fully Secure"], ["insecure", "Not Secure"], ["certificateError", "Not Secure"]]) {
      const html = fixture.render("ConnectionChip", { level, url: "https://test", origin: "https://test" });
      assert.match(html, new RegExp(label));
      assert.doesNotMatch(html, /information unavailable/);
    }
  } finally {
    await rm(entry, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
