const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

type Movable = Element & { moveBefore?: (node: Node, child: Node | null) => void };

let size = { width: 1218, height: 821 };
let host: HTMLDivElement | null = null;
const pool = new Map<string, HTMLIFrameElement>();

export function noteFrameSize(width: number, height: number) {
  if (width <= 0 || height <= 0) return;
  size = { width, height };
  for (const frame of pool.values()) Object.assign(frame.style, { width: `${width}px`, height: `${height}px` });
}

function poolHost() {
  if (host?.isConnected) return host;
  host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: "0", top: "0", zIndex: "-1", pointerEvents: "none", opacity: "0" });
  document.body.prepend(host);
  return host;
}

export function createFrame(url: string, title: string) {
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = title;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.setAttribute("sandbox", SANDBOX);
  Object.assign(frame.style, { border: "0", width: "100%", height: "100%", display: "block", background: "#FFFFFF" });
  frame.addEventListener("load", () => (frame.dataset.loaded = url));
  return frame;
}

export function moveFrame(frame: HTMLIFrameElement, into: Element) {
  const target = into as Movable;
  if (frame.parentElement === into) return;
  if (target.moveBefore && frame.isConnected) target.moveBefore(frame, null);
  else into.append(frame);
}

export function warmFrame(url: string, title: string) {
  if (pool.has(url)) return;
  const frame = createFrame(url, title);
  Object.assign(frame.style, { position: "absolute", left: "0", top: "0", width: `${size.width}px`, height: `${size.height}px` });
  pool.set(url, frame);
  poolHost().append(frame);
}

export function takeFrame(url: string) {
  const frame = pool.get(url);
  if (!frame) return null;
  pool.delete(url);
  Object.assign(frame.style, { position: "", left: "", top: "", width: "100%", height: "100%" });
  return frame;
}

export function parkFrame(frame: HTMLIFrameElement) {
  const url = frame.dataset.loaded;
  if (!url || pool.has(url)) return frame.remove();
  Object.assign(frame.style, { position: "absolute", left: "0", top: "0", width: `${size.width}px`, height: `${size.height}px` });
  pool.set(url, frame);
  moveFrame(frame, poolHost());
}
