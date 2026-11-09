import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const [appArg, port] = process.argv.slice(2);
if (!appArg) {
  console.error("usage: node zoom-scroll-test.mjs <Debug Ardia.app> [cdpPort]");
  process.exit(2);
}
const scratch = mkdtempSync(join(tmpdir(), "ac-zoom-scroll-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "zoom-scroll-test.log"), { name: "zoom-scroll-test" });

const TALL = `<!doctype html><title>tall</title><body style="font:20px system-ui;height:6000px"><h1>tall</h1>`;
const MAP = `<!doctype html><title>map</title><body style="font:20px system-ui;height:6000px"><h1>map</h1><script>
window.mapWheels = 0;
document.addEventListener("wheel", (e) => { if (e.metaKey) { e.preventDefault(); window.mapWheels++; } }, { passive: false });
</script>`;
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(req.url.startsWith("/map") ? MAP : TALL);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

let app;
try {
  app = await launch(resolve(appArg), {
    data, port,
    session: session({ tabs: [{ id: "t1", url: `${base}/`, title: "tall" }] }),
    ready: "return !!globalThis.ac?.engine",
  });
  const ac = (body) => app.eval(body, { timeout: 60000 });
  const titled = async (title) => {
    for (let i = 0; i < 60 && !(await ac(`return ac.store.getState().tabs.t1?.title === ${JSON.stringify(title)};`)); i++) await sleep(500);
    await sleep(1500);
  };
  await titled("tall");

  const zoom = () => ac(`return ac.store.getState().tabs.t1.zoom;`);
  const page = (expr) => ac(`return ac.webviews.get("t1").evaluate(${JSON.stringify(`post("result", JSON.stringify(${expr}))`)});`);
  const reset = async () => {
    await ac(`return ac.webviews.get("t1")?.zoomStep(0);`);
    for (let i = 0; i < 20 && (await zoom()) !== 1; i++) await sleep(200);
    await page("(scrollTo(0, 0), true)");
  };
  const scroll = (steps) => ac(`return ac.engine.call("tabs.devScrollZoom", ${JSON.stringify({ steps })});`);
  const withCommand = async (steps) => {
    const held = await scroll([{ phase: "command" }]);
    await sleep(400);
    const zoomed = await scroll(steps);
    await sleep(800);
    await scroll([{ phase: "commandUp" }]);
    return { held: held[0], zoomed };
  };
  const setting = (on) => ac(`ac.store.getState().updateSettings({ commandScrollZoom: ${on} }); return true;`);
  const gesture = (trackpad) => [
    { phase: "mayBegin", dy: 0, trackpad },
    { phase: "began", dy: 12, trackpad },
    ...Array.from({ length: 4 }, () => ({ phase: "changed", dy: 40, trackpad })),
    { phase: "ended", dy: 0, trackpad },
    ...Array.from({ length: 3 }, () => ({ phase: "momentum", dy: 30 })),
  ];
  const notches = (n, dy = 1) => Array.from({ length: n }, () => ({ phase: "wheel", dy }));

  const scrollCase = (name, steps, expectZoom) => rep.check(name, async () => {
    await reset();
    const { held, zoomed } = await withCommand(steps);
    const after = await zoom();
    const scrollY = await page("scrollY");
    const detail = `⌘ seen ${held}, taken as a zoom per event ${JSON.stringify(zoomed)}, zoom ${after}, scrollY ${scrollY}`;
    if (!(expectZoom ? zoomed.some(Boolean) && after > 1 && scrollY === 0 : zoomed.every((z) => !z) && after === 1)) throw new Error(detail);
    return detail;
  });

  await scrollCase("⌘ + two-finger trackpad scroll scrolls (and its momentum too)", gesture(true), false);
  await scrollCase("⌘ + Magic Mouse scroll zooms", gesture(false), true);
  await scrollCase("⌘ + wheel-mouse notches zoom, and the page doesn't scroll", notches(2), true);
  await rep.check("a trackpad scroll that ended doesn't stop the wheel from zooming", async () => {
    await reset();
    await withCommand(gesture(true));
    const { zoomed } = await withCommand(notches(2));
    const after = await zoom();
    const detail = `taken as a zoom ${JSON.stringify(zoomed)}, zoom ${after}`;
    if (!zoomed.some(Boolean) || !(after > 1)) throw new Error(detail);
    return detail;
  });

  await rep.check("with the setting off, ⌘ + wheel scrolls the page and never zooms", async () => {
    await reset();
    await setting(false);
    try {
      await sleep(300);
      const { zoomed } = await withCommand(notches(3, -3));
      const after = await zoom();
      const scrollY = await page("scrollY");
      const detail = `taken as a zoom ${JSON.stringify(zoomed)}, zoom ${after}, scrollY ${scrollY}`;
      if (zoomed.some(Boolean) || after !== 1 || !(scrollY > 0)) throw new Error(detail);
      return detail;
    } finally {
      await setting(true);
      await sleep(300);
    }
  });

  await rep.check("a page that handles ⌘ + wheel itself gets it, and the page doesn't zoom", async () => {
    await ac(`ac.store.getState().navigate("t1", "${base}/map", { userInitiated: true }); return true;`);
    await titled("map");
    await reset();
    await withCommand(notches(3));
    const after = await zoom();
    const wheels = await page("window.mapWheels");
    const detail = `the page's ⌘-wheels ${wheels}, zoom ${after}`;
    if (!(wheels > 0) || after !== 1) throw new Error(detail);
    return detail;
  });
  await reset();
} catch (error) {
  rep.record("setup", { error });
} finally {
  await app?.quit();
  server.close();
  rmSync(data, { recursive: true, force: true });
}
process.exit(rep.summary() ? 0 : 1);
