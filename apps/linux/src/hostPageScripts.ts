export const PICTURE_IN_PICTURE_STATE = 'post("result", JSON.stringify(!!document.pictureInPictureElement || !!window.documentPictureInPicture?.window))';
export const CLOSE_DOCUMENT_PICTURE_IN_PICTURE = "window.documentPictureInPicture?.window?.close()";

export const UNSAVED_WORK = `(() => {
  const fields = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=password]):not([type=submit]):not([type=button]), textarea, select"));
  const changed = (f) => f.type === "checkbox" || f.type === "radio" ? f.checked !== f.defaultChecked : f.tagName === "SELECT" ? Array.from(f.options).some((o) => o.selected !== o.defaultSelected) : f.value !== f.defaultValue;
  const editing = document.activeElement && document.activeElement.isContentEditable;
  post("result", JSON.stringify(fields.some(changed) || !!editing));
})()`;

export const WEB_STORE_REQUEST = `
const g = window;
if (!g.__ardiaStore) {
  const store = (g.__ardiaStore = { waiting: null, queued: [] });
  const request = (id) => {
    if (!id) return;
    if (store.waiting) { const w = store.waiting; store.waiting = null; w(id); } else store.queued.push(id);
  };
  const mg = g.chrome && g.chrome.management;
  if (mg && typeof mg.uninstall === "function") {
    Object.defineProperty(mg, "uninstall", { configurable: true, writable: true, value: (id, options, callback) => {
      request(id);
      const done = typeof options === "function" ? options : callback;
      if (typeof done === "function") { setTimeout(done); return; }
      return Promise.resolve();
    } });
  }
  const relabel = () => {
    for (const el of document.querySelectorAll("button, button *")) {
      if (el.childElementCount) continue;
      const t = el.textContent;
      if (t === "Add to Chrome") el.textContent = "Add to Ardia";
      else if (t === "Remove from Chrome") el.textContent = "Remove from Ardia";
    }
  };
  relabel();
  new MutationObserver(relabel).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
}
const store = g.__ardiaStore;
if (store.queued.length) post("result", JSON.stringify(store.queued.shift()));
else store.waiting = (id) => post("result", JSON.stringify(id));
`;

export type HostPageScript = { command: string; args: unknown[]; map?: (result: unknown) => unknown; failed?: () => unknown };

export const WEB_STORE_RETRY_MS = 1000;

const superseded = (answer: unknown) => !!answer && typeof answer === "object" && (answer as { superseded?: unknown }).superseded === true;

export function webStoreAnswer(answer: unknown): unknown {
  if (superseded(answer)) return new Promise(() => {});
  return typeof answer === "string" ? answer : null;
}

export function webStoreFailed(): Promise<null> {
  return new Promise((resolve) => setTimeout(() => resolve(null), WEB_STORE_RETRY_MS));
}

export function hostPageScript(method: string, args: readonly unknown[]): HostPageScript | null {
  if (args.length !== 1) return null;
  if (method === "evaluate" && args[0] === PICTURE_IN_PICTURE_STATE) return { command: "pictureInPictureState", args: [] };
  if (method === "executeJavaScript" && args[0] === CLOSE_DOCUMENT_PICTURE_IN_PICTURE) return { command: "exitPictureInPicture", args: [] };
  if (method === "evaluate" && args[0] === UNSAVED_WORK) return { command: "editedInput", args: [], map: (edited) => edited !== false };
  if (method === "evaluate" && args[0] === WEB_STORE_REQUEST) return { command: "webStoreRequest", args: [], map: webStoreAnswer, failed: webStoreFailed };
  return null;
}
