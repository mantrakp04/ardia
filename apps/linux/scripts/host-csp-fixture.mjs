import http from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { shellContentSecurityPolicy } from "./shell-csp.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "ardia-symbol-csp-"));
const output = join(scratch, "dist");
await build({
  root,
  configFile: join(root, "vite.config.ts"),
  logLevel: "error",
  build: {
    outDir: output,
    emptyOutDir: true,
    rollupOptions: { input: join(root, "scripts/host-csp-entry.mjs"), output: { entryFileNames: "assets/host-csp-entry.js" } },
  },
});

const policy = shellContentSecurityPolicy();
const mock = `
window.__ardiaCspFixture = { errors: [], htmlAssignments: [], suggestRequests: [], launchSteps: [] };
window.addEventListener('error', event => __ardiaCspFixture.errors.push(event.error?.stack || event.message));
window.addEventListener('unhandledrejection', event => __ardiaCspFixture.errors.push(String(event.reason)));
const html = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
Object.defineProperty(Element.prototype, 'innerHTML', { ...html, set(value) {
  __ardiaCspFixture.htmlAssignments.push(trustedTypes.isHTML(value));
  html.set.call(this, value);
} });
const listeners = new Set();
const closing = new Set();
const folder = (id) => ({ id, k:'f', t:id, a:0, c:[] });
const noops = new Set(['ArdiaShell.openWindow','ArdiaShell.setKeyboardShortcuts','ArdiaShell.setWindowTitle','ArdiaShell.setMenuState','ArdiaShell.setMenuBookmarks','ArdiaShell.cancelFocusMove','ArdiaShell.replyToTerminate','ArdiaCEF.setDisplayMediaPicker','ArdiaCEF.setSearchEngineName','ArdiaChromeUI.watchCastRoutes','ArdiaCEF.prepareTransfer','ArdiaCEF.releaseTransfer','ArdiaShell.writeDocument','ArdiaShell.removeDocument']);
window.__ardiaHost = {
  bootstrap: { windowId:'w_csp', profileId:'default', startup:true, documents:{}, nativeModules:{ArdiaApp:{}}, capabilities:['ArdiaSearch.suggest','ArdiaSearch.cancelSuggest','ArdiaShell.launchSteps','ArdiaShell.completeLaunchStep'] },
  async call(name) {
    if(['ac_bookmarks_tree','bookmarks.tree'].includes(name))return JSON.stringify({bar:folder('bar'),other:folder('other')});
    if(['ac_history_query','history.query'].includes(name))return JSON.stringify({entries:[]});
    if(['ac_favicons_get','favicons.get'].includes(name))return JSON.stringify({pages:{},icons:{}});
    if(['ac_tabs_last_tab_policy','tabs.lastTabPolicy'].includes(name))return JSON.stringify({closesWindow:false});
    if(name==='tabs.strips')return JSON.stringify({rev:0,cmd:null,strips:[]});
    if(['ac_bookmarks_watch','ac_history_watch','ac_extensions_watch_actions','bookmarks.watch','history.watch','extensions.watchActions','media.watchCastRoutes','search.setEngineName'].includes(name)||name.startsWith('webView.set'))return '{}';
    throw new Error('Unexpected fixture engine call '+name);
  },
  async invoke(method, args) {
    if(method==='ArdiaShell.launchSteps')return [...__ardiaCspFixture.launchSteps];
    if(method==='ArdiaShell.completeLaunchStep'){const fresh=!__ardiaCspFixture.launchSteps.includes(args.args[0]);if(fresh)__ardiaCspFixture.launchSteps.push(args.args[0]);return fresh;}
    if(method==='ArdiaShell.readDocument')return null;
    if(method==='ArdiaSearch.cancelSuggest')return null;
    if(method==='ArdiaSearch.suggest'){__ardiaCspFixture.suggestRequests.push(args.args[0]);return {body:JSON.stringify(['ardia csp',['ardia csp fixture']])};}
    if(method==='session.read')return null;
    if(method==='session.write')return;
    if(method==='ArdiaExtensions.list')return {extensions:[]};
    if(method==='ArdiaExtensions.searchEngineList')return {list:null};
    if(method==='ArdiaShell.windowIds')return ['w_csp'];
    if(method==='ArdiaCEF.tabStrips')return {rev:0,cmd:null,strips:[]};
    if(noops.has(method))return;
    throw new Error('Unexpected fixture host call '+method);
  },
  onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  onBeforeClose(listener) { closing.add(listener); return () => closing.delete(listener); },
};
window.addEventListener('pagehide', () => { for(const listener of closing)listener(); });
`;
const styles = (await readdir(join(output, "assets"))).filter((name) => name.endsWith(".css"));
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ardia Trusted Types fixture</title>${styles.map((name) => `<link rel="stylesheet" href="/assets/${name}">`).join("")}</head><body><div id="root"></div><div id="symbol-fixture" style="position:absolute;left:-2000px;top:0;width:1000px"></div><script src="/fixture-host.js"></script><script type="module" src="/assets/host-csp-entry.js"></script></body></html>`;
const mime = { ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer(async (request, response) => {
  response.setHeader("Content-Security-Policy", policy);
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/") {
    response.setHeader("Content-Type", "text/html");
    return response.end(html);
  }
  if (pathname === "/fixture-host.js") {
    response.setHeader("Content-Type", "application/javascript");
    return response.end(mock);
  }
  const path = resolve(output, `.${pathname}`);
  if (!path.startsWith(output + sep)) return response.writeHead(403).end();
  try {
    response.setHeader("Content-Type", mime[extname(path)] ?? "application/octet-stream");
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, "127.0.0.1", () => console.log(`Ardia CSP fixture http://127.0.0.1:${server.address().port}/`));
const stop = () => {
  server.closeAllConnections();
  server.close(() => void rm(scratch, { recursive: true, force: true }).then(() => process.exit(0)));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
