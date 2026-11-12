import { devtools, sleep, uboReady } from "./instance.mjs";

const [port, seconds = "90"] = process.argv.slice(2);
const adUrl = "https://ib.adnxs.com/ut/v3?ardia-release-check";
const deadline = Date.now() + Number(seconds) * 1000;
const left = () => Math.max(1, deadline - Date.now());

function bounded(promise, what) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), left());
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

async function getJson(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(Math.min(5000, left())) });
  return response.json();
}

async function connect(target) {
  return bounded(devtools(target), `connecting to ${target.url}`);
}

async function blocks() {
  const version = await getJson("/json/version");
  const browser = await connect({ webSocketDebuggerUrl: version.webSocketDebuggerUrl, url: "browser" });
  let targetId;
  try {
    ({ targetId } = await browser.send("Target.createTarget", { url: "about:blank", background: true }, { timeout: Math.min(10000, left()) }));
    let page;
    while (!page && Date.now() < deadline) {
      page = (await getJson("/json/list").catch(() => [])).find((t) => t.id === targetId);
      if (!page) await sleep(Math.min(200, left()));
    }
    if (!page) throw new Error("the check page never appeared");
    const session = await connect(page);
    try {
      const failures = [];
      session.on("Network.loadingFailed", (p) => failures.push(p.errorText));
      await session.send("Network.enable", {}, { timeout: Math.min(10000, left()) });
      const fetched = await session.eval(`fetch(${JSON.stringify(adUrl)}, { mode: "no-cors" }).then(() => "loaded", () => "failed")`, { timeout: Math.min(15000, left()) });
      await sleep(300);
      const blocked = failures.find((e) => /ERR_BLOCKED_BY_CLIENT/.test(e));
      if (fetched !== "failed" || !blocked) throw new Error(`an ad request wasn't blocked (${fetched}; ${failures.join(", ") || "no failure"})`);
      return blocked;
    } finally {
      session.close();
    }
  } finally {
    if (targetId) await browser.send("Target.closeTarget", { targetId }, { timeout: 3000 }).catch(() => {});
    browser.close();
  }
}

try {
  const ready = await uboReady(port, { seconds: Number(seconds), until: deadline });
  const blocked = await bounded(blocks(), "the blocking check");
  console.log(`uBlock Origin ready (${ready}) and blocking (${blocked})`);
  process.exit(0);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
