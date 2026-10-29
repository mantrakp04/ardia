import { evaluate } from "../lib/cdp.mjs";
import { startBrowser } from "../lib/flows.mjs";
import { openPage, pageState } from "../lib/pages.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { js, nonce, until } from "../lib/util.mjs";

export const SHIFT = 8;
export const ALT = 1;
export const QUIET_MS = 2500;

export async function clickAt(session, { x, y }, modifiers = 0, clickCount = 1) {
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount, modifiers });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount, modifiers });
}

export function centerOf(session, expression) {
  return evaluate(session, `(() => { const r = (${expression}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
}

const peekOf = (shell) => shell.state("const peek = s.peeks[windowId]; return peek ? { tabId: peek.tabId, url: s.tabs[peek.tabId]?.url ?? null } : null;");
const closePeek = (shell) => shell.eval("(() => { const s = ardiaLinux.store.getState(); const w = Object.keys(s.peeks)[0]; if (w) s.closePeek?.(w); return true; })()");
const splitWith = (shell, url) => shell.state(`const tab = Object.values(s.tabs).find((t) => t.url === ${js(url)}); if (!tab) return false; return Object.values(s.splits).some((split) => JSON.stringify(split).includes(tab.id)) ? tab.id : false;`);
const selectionOf = (shell, tabId) => shell.eval(`ardiaLinux.selection.state.getState()[${js(tabId)}] ?? null`);

export default {
  id: "F16",
  issue: 26,
  title: "Peek and split link gestures, selection tools and untrusted page messages on native pages",
  deadline: 300000,
  async run(t) {
    const run = nonce("f16");
    const state = await startBrowser(t, { name: "page-messaging" });
    const { shell } = state;
    const { url } = t.fixtures;
    let page;
    await t.check("the page, selection and peek stores are reachable from the shell", async () => {
      page = await openPage(shell, url.gestures(run));
      const ok = await shell.eval("typeof ardiaLinux.selection?.state?.getState === 'function' && typeof ardiaLinux.toolbar?.getState === 'function'");
      if (!ok) throw new Error("ardiaLinux.selection or ardiaLinux.toolbar is missing");
      return { tabId: page.tabId };
    }, { critical: true });

    await t.check("page script globals stay out of the page's main world", async () => {
      const leaked = await evaluate(page.session, "['post', '__ardiaHost', '__ardiaPage', 'webkit'].filter((name) => typeof globalThis[name] !== 'undefined')");
      if (leaked.length) throw new Error(`main world sees ${leaked.join(", ")}`);
      return true;
    });

    await t.check("synthetic clicks and forged messages from the page open nothing", async () => {
      await evaluate(page.session, `(() => {
        const link = document.getElementById("link");
        link.addEventListener("click", (e) => e.preventDefault(), { once: true });
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true, button: 0 }));
        window.postMessage({ kind: "peek", data: { url: ${js(url.page(6, run))}, key: "shift" } }, "*");
        window.postMessage({ kind: "linkDrop", data: { url: ${js(url.page(9, run))} } }, "*");
        return true;
      })()`);
      await delay(QUIET_MS);
      const peek = await peekOf(shell);
      const opened = await shell.state(`return Object.values(s.tabs).filter((x) => x.url === ${js(url.page(6, run))} || x.url === ${js(url.page(9, run))}).length;`);
      if (peek || opened) throw new Error(`forged input opened ${JSON.stringify({ peek, opened })}`);
      return true;
    });

    await t.check("a shift-click on a link opens it in a peek", async () => {
      const target = url.page(6, run);
      await clickAt(page.session, await centerOf(page.session, "document.getElementById('link')"), SHIFT);
      const peek = await until(async () => { const p = await peekOf(shell); return p?.url === target ? p : false; }, { timeout: 10000, label: "the peek" });
      await t.screenshot(shell, "peek");
      await closePeek(shell);
      await until(async () => !(await peekOf(shell)), { timeout: 8000, label: "the peek to close" });
      return peek;
    });

    await t.check("an alt-shift-click on a link opens it in a split pane", async () => {
      const target = url.page(6, run);
      await clickAt(page.session, await centerOf(page.session, "document.getElementById('link')"), ALT | SHIFT);
      return until(() => splitWith(shell, target), { timeout: 10000, label: "the split pane" });
    });

    await t.check("a shift-click on a link inside a cross-site iframe opens a peek", async () => {
      const framed = await openPage(shell, url.gestures(`${run}-frame`));
      const target = url.page(7, `${run}-frame`);
      await until(() => evaluate(framed.session, "document.getElementById('frame').contentWindow && document.readyState === 'complete'"), { timeout: 10000, label: "the iframe" });
      const frame = await centerOf(framed.session, "document.getElementById('frame')");
      await delay(500);
      await clickAt(framed.session, { x: frame.x - 40, y: frame.y - 20 }, SHIFT);
      const peek = await until(async () => { const p = await peekOf(shell); return p?.url === target ? p : false; }, { timeout: 10000, label: "the iframe peek" });
      await closePeek(shell);
      page = framed;
      return peek;
    });

    await t.check("selecting words reports the selection and Escape in the page clears it", async () => {
      await clickAt(page.session, await centerOf(page.session, "(() => { const text = document.getElementById('words').firstChild; const r = document.createRange(); r.setStart(text, 6); r.setEnd(text, 13); return r; })()"), 0, 2);
      const selected = await until(async () => { const s = await selectionOf(shell, page.tabId); return s?.text ? s : false; }, { timeout: 8000, label: "the selection" });
      await t.screenshot(shell, "selection-popover");
      await page.session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page.session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await until(async () => (await selectionOf(shell, page.tabId)) === null, { timeout: 8000, label: "the selection to clear" });
      return { text: selected.text };
    });

    await t.check("jump to selection and copy quote link use the page's selection", async () => {
      await evaluate(page.session, "(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('words')); getSelection().removeAllRanges(); getSelection().addRange(r); window.scrollTo(0, 2000); return true; })()");
      const jumped = await shell.eval(`ardiaLinux.selection.jump(${js(page.tabId)})`);
      if (jumped !== true) throw new Error(`jumpToSelection answered ${JSON.stringify(jumped)}`);
      const scrolled = await evaluate(page.session, "window.scrollY");
      if (scrolled >= 2000) throw new Error(`the page did not scroll to the selection (${scrolled})`);
      await shell.eval(`ardiaLinux.selection.copyQuoteLink(${js(page.tabId)}).then(() => true)`);
      await until(async () => (await shell.text()).includes("Copied Quote Link"), { timeout: 8000, label: "the quote link toast" });
      return { scrolled };
    });

    await t.check("replace in a focused text field rewrites every match", async () => {
      await evaluate(page.session, "(() => { const f = document.getElementById('field'); f.focus(); f.setSelectionRange(0, 0); return true; })()");
      const result = await shell.eval(`ardiaLinux.selection.replaceInField(${js(page.tabId)}, "alpha", "gamma", true)`);
      if (!result?.field || result.count !== 2) throw new Error(`replaceInField answered ${JSON.stringify(result)}`);
      const value = await evaluate(page.session, "document.getElementById('field').value");
      if (value !== "gamma beta gamma") throw new Error(`the field reads ${JSON.stringify(value)}`);
      return result;
    });

    await t.check("the page state still belongs to the tab", async () => {
      const current = await pageState(shell, page.tabId);
      if (!current) throw new Error("the page state is gone");
      return true;
    });
  },
};
