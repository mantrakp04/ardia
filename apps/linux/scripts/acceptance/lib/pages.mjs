import { js, until } from "./util.mjs";

export function pageState(shell, tabId) {
  return shell.eval(`(ardiaLinux.pages?.getState().pages ?? {})[${js(tabId)}] ?? null`);
}

export async function waitPage(shell, tabId, test, { timeout = 15000, label = `page state of ${tabId}` } = {}) {
  return until(async () => {
    const page = await pageState(shell, tabId);
    return page && test(page) ? page : false;
  }, { timeout, label, abort: () => shell.app.exitReason() });
}

export async function openPage(shell, url) {
  const tabId = await shell.newTab(url);
  await shell.waitTabUrl(tabId, (u) => u === url, { label: `tab to commit ${url}` });
  const target = await shell.app.pageLoaded(url);
  const session = await shell.app.connect(target);
  return { tabId, target, session };
}

export function gesture(session, expression, timeout = 10000) {
  return session.send("Runtime.evaluate", { expression, userGesture: true, awaitPromise: true, returnByValue: true }, { timeout });
}
