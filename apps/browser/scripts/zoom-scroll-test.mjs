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

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  if (req.url === "/framed-tall")
    return res.end(`<!doctype html><title>framed tall</title><body style="margin:0"><iframe src="/" style="border:0;width:100vw;height:100vh">`);
  if (req.url === "/framed")
    return res.end(`<!doctype html><title>framed</title><body style="margin:0"><iframe src="/map" style="border:0;width:100vw;height:100vh">`);
  if (req.url === "/map")
    return res.end(`<!doctype html><title>map</title><body style="margin:0"><div id="map" style="height:100vh"></div><script>
      let zooms = 0;
      map.addEventListener("wheel", (e) => { if (e.metaKey) { e.preventDefault(); top.document.title = "map " + ++zooms; } }, { passive: false });
      top.document.title = "map 0";
    </script>`);
  res.end(`<!doctype html><title>tall</title><body style="font:20px system-ui;height:6000px"><h1>tall</h1>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

let app;
try {
  app = await launch(resolve(appArg), {
    data, port,
    session: session({ tabs: [{ id: "t1", url, title: "tall" }] }),
    ready: "return !!globalThis.ac?.engine",
  });
  const ac = (body) => app.eval(body, { timeout: 60000 });
  for (let i = 0; i < 60 && !(await ac(`return ac.store.getState().tabs.t1?.title === "tall";`)); i++) await sleep(500);
  await sleep(1500);

  const zoom = () => ac(`return ac.store.getState().tabs.t1.zoom;`);
  const reset = async () => {
    await ac(`return ac.webviews.get("t1")?.zoomStep(0);`);
    for (let i = 0; i < 20 && (await zoom()) !== 1; i++) await sleep(200);
  };
  const scroll = (steps) => ac(`return ac.engine.call("tabs.devScrollZoom", ${JSON.stringify({ steps })});`);
  const gesture = (trackpad) => [
    { phase: "mayBegin", dy: 0, trackpad },
    { phase: "began", dy: 12, trackpad },
    ...Array.from({ length: 4 }, () => ({ phase: "changed", dy: 40, trackpad })),
    { phase: "ended", dy: 0, trackpad },
    ...Array.from({ length: 3 }, () => ({ phase: "momentum", dy: 30 })),
  ];

  const scrollCase = (name, steps, expectZoom) => rep.check(name, async () => {
    await reset();
    const zoomed = await scroll(steps);
    await sleep(800);
    const after = await zoom();
    const scrolled = zoomed.every((z) => !z);
    const detail = `zoomed per event ${JSON.stringify(zoomed)}, zoom ${after}`;
    if (!(expectZoom ? zoomed.some(Boolean) && after > 1 : scrolled && after === 1)) throw new Error(detail);
    return detail;
  });

  await scrollCase("⌘ + two-finger trackpad scroll scrolls (and its momentum too)", gesture(true), false);
  await scrollCase("⌘ + Magic Mouse scroll zooms", gesture(false), true);
  await scrollCase("⌘ + wheel-mouse notches zoom", [{ phase: "wheel", dy: 1 }, { phase: "wheel", dy: 1 }], true);
  await scrollCase("a trackpad scroll that ended doesn't stop the wheel from zooming",
    [...gesture(true), { phase: "wheel", dy: 1 }, { phase: "wheel", dy: 1 }], true);
  await reset();

  const takenByPage = (page, what) => rep.check(`${what} that takes ⌘-wheel gets it, and the browser doesn't zoom`, async () => {
    await ac(`ac.store.getState().navigate("t1", "${url}${page}", { userInitiated: true }); return true;`);
    for (let i = 0; i < 40 && (await ac(`return ac.store.getState().tabs.t1?.title;`)) !== "map 0"; i++) await sleep(250);
    await scroll([{ phase: "wheel", dy: 1 }, { phase: "wheel", dy: 1 }]);
    await sleep(800);
    const title = await ac(`return ac.store.getState().tabs.t1.title;`);
    const after = await zoom();
    const detail = `page title ${title}, zoom ${after}`;
    if (title !== "map 2" || after !== 1) throw new Error(detail);
    return detail;
  });
  await takenByPage("map", "a page");
  await takenByPage("framed", "a page in an iframe");
  await ac(`ac.store.getState().navigate("t1", "${url}framed-tall", { userInitiated: true }); return true;`);
  for (let i = 0; i < 40 && (await ac(`return ac.store.getState().tabs.t1?.title;`)) !== "framed tall"; i++) await sleep(250);
  await scrollCase("⌘ + wheel over an iframe that doesn't take it zooms", [{ phase: "wheel", dy: 1 }, { phase: "wheel", dy: 1 }], true);
  await reset();
} catch (error) {
  rep.record("setup", { error });
} finally {
  await app?.quit();
  server.close();
  rmSync(data, { recursive: true, force: true });
}
process.exit(rep.summary() ? 0 : 1);
