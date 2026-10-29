import { restartBrowser, startBrowser } from "../lib/flows.mjs";
import { openPage } from "../lib/pages.mjs";
import { js, nonce, until } from "../lib/util.mjs";

async function shellIcons(shell) {
  return shell.eval("[...document.querySelectorAll('img')].map((i) => i.currentSrc || i.src).filter((src) => src.startsWith('data:image/png;base64,'))");
}

async function fetchIcon(shell, url) {
  const reply = await shell.call("favicons.fetch", { url });
  if (!reply.ok) throw new Error(`favicons.fetch failed: ${reply.code} ${reply.message}`);
  return reply.value;
}

export default {
  id: "F24",
  issue: 34,
  title: "Favicons are fetched through the page's profile on a cache miss and survive restart",
  deadline: 300000,
  async run(t) {
    const run = nonce("f24");
    const { url, ports } = t.fixtures;
    const publicFixture = [`--ip-address-space-overrides=127.0.0.1:${ports.http}=public`];
    let state = await startBrowser(t, { name: "favicons", extraArgs: publicFixture });
    const label = `fresh${run}`;
    const pageUrl = url.favicon(label);
    const iconPath = `/icon/${label}.png`;
    let tabId;
    await t.check("a fresh profile downloads the page's favicon and shows it", async () => {
      ({ tabId } = await openPage(state.shell, pageUrl));
      await until(() => t.fixtures.requests.some((r) => r.path === iconPath), { timeout: 15000, label: "the icon request" });
      const icons = await until(async () => {
        const list = await shellIcons(state.shell);
        return list.length ? list : false;
      }, { timeout: 15000, label: "a PNG favicon in the shell" });
      await t.screenshot(state.shell, "favicon-fresh");
      return { tabId, icons: icons.length };
    }, { critical: true });
    await t.check("favicons.fetch returns a bounded PNG through the page profile", async () => {
      const image = await fetchIcon(state.shell, url.icon(`net${run}`));
      if (!image?.uri?.startsWith("data:image/png;base64,") || !(image.width > 0 && image.width <= 64)) throw new Error(`unexpected image ${JSON.stringify(image)}`);
      const request = t.fixtures.requests.find((r) => r.path === `/icon/net${run}.png`);
      if (!request) throw new Error("the icon request never reached the fixture server");
      if (request.headers.cookie) throw new Error("the icon request carried cookies");
      return { width: image.width, height: image.height };
    });
    await t.check("malformed, unreachable and non-web icons fall back to null", async () => {
      const bad = await fetchIcon(state.shell, url.icon(`bad${run}`));
      const missing = await fetchIcon(state.shell, `http://missing.invalid/icon.png`);
      const local = await fetchIcon(state.shell, "file:///etc/hostname");
      if (bad !== null || missing !== null || local !== null) throw new Error(`expected null fallbacks, got ${js({ bad, missing, local })}`);
      return { bad, missing, local };
    });
    await t.check("favicons.fetch never reaches the local network", async () => {
      const literal = await fetchIcon(state.shell, `http://127.0.0.1:${ports.http}/icon/lit${run}.png`);
      const named = await fetchIcon(state.shell, `http://localhost:${ports.http}/icon/name${run}.png`);
      const resolved = await fetchIcon(state.shell, url.https("icons.ardia.test", `/icon/lna${run}.png`));
      if (literal !== null || named !== null || resolved !== null) throw new Error(`a local-network icon was fetched: ${js({ literal, named, resolved })}`);
      const reached = t.fixtures.requests.filter((r) => [`/icon/lit${run}.png`, `/icon/name${run}.png`, `/icon/lna${run}.png`].includes(r.path));
      if (reached.length) throw new Error(`local-network requests reached the fixture: ${js(reached.map((r) => r.path))}`);
      return { literal, named, resolved };
    });
    await t.check("the fetched favicon survives restart", async () => {
      const before = t.fixtures.requests.filter((r) => r.path === iconPath).length;
      state = await restartBrowser(t, state, { extraArgs: publicFixture });
      const icons = await until(async () => {
        const list = await shellIcons(state.shell);
        return list.length ? list : false;
      }, { timeout: 20000, label: "the favicon after restart" });
      return { icons: icons.length, requestsBefore: before, requestsAfter: t.fixtures.requests.filter((r) => r.path === iconPath).length };
    });
  },
};
