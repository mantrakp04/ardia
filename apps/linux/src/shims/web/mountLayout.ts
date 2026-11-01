type Measured = {
  nodeType: number;
  offsetLeft: number;
  offsetTop: number;
  offsetWidth: number;
  offsetHeight: number;
  clientLeft: number;
  clientTop: number;
  scrollLeft: number;
  scrollTop: number;
  offsetParent: unknown;
};

type Mounted = Measured & { isConnected: boolean; parentNode: unknown };
type Viewport = { scrollX: number; scrollY: number };

export type MountLayoutEvent = {
  nativeEvent: { layout: { x: number; y: number; width: number; height: number; left: number; top: number }; target: unknown };
  timeStamp: number;
};

const isElement = (node: unknown): node is Measured => !!node && (node as Measured).nodeType === 1;

function pageRect(node: Measured, viewport: Viewport) {
  let left = node.offsetLeft;
  let top = node.offsetTop;
  for (let parent = node.offsetParent; isElement(parent); parent = parent.offsetParent) {
    left += parent.offsetLeft + parent.clientLeft - parent.scrollLeft;
    top += parent.offsetTop + parent.clientTop - parent.scrollTop;
  }
  return { width: node.offsetWidth, height: node.offsetHeight, left: left - viewport.scrollX, top: top - viewport.scrollY };
}

export function reportMountLayout(node: Mounted | null, onLayout: ((event: MountLayoutEvent) => void) | undefined, viewport: Viewport) {
  const parent = node?.parentNode as Mounted | null | undefined;
  if (!node || !onLayout || !node.isConnected || !isElement(parent) || !parent.isConnected) return;
  const relative = pageRect(parent, viewport);
  const { width, height, left, top } = pageRect(node, viewport);
  onLayout({ nativeEvent: { layout: { x: left - relative.left, y: top - relative.top, width, height, left, top }, target: node }, timeStamp: Date.now() });
}

type LayoutHandler = (event: MountLayoutEvent) => void;
type Frame = { x: number; y: number; width: number; height: number };
type Watched = { node: Mounted; handler: () => LayoutHandler | undefined; viewport: Viewport; last: Frame | null };

function frameOf(node: Mounted, viewport: Viewport): Frame | null {
  const parent = node.parentNode as Mounted | null | undefined;
  if (!node.isConnected || !isElement(parent) || !parent.isConnected) return null;
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  if (node.offsetParent === parent) return { x: node.offsetLeft + parent.clientLeft - parent.scrollLeft, y: node.offsetTop + parent.clientTop - parent.scrollTop, width, height };
  const relative = pageRect(parent, viewport);
  const own = pageRect(node, viewport);
  return { x: own.left - relative.left, y: own.top - relative.top, width, height };
}

const sameFrame = (a: Frame, b: Frame | null) => !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const watched = new Map<Mounted, Watched>();
const parents = new Map<Element, number>();
const touched = new Set<Node>();
let resizes: ResizeObserver | null = null;
let mutations: MutationObserver | null = null;
let pending = false;

function settle(entry: Watched) {
  const frame = frameOf(entry.node, entry.viewport);
  if (!frame || sameFrame(frame, entry.last)) return;
  entry.last = frame;
  reportMountLayout(entry.node, entry.handler(), entry.viewport);
}

function settleTouched() {
  pending = false;
  const around = new Set<unknown>();
  for (const target of touched) for (let node: Node | null = target; node && !around.has(node); node = node.parentNode) around.add(node);
  touched.clear();
  for (const entry of [...watched.values()]) if (around.has(entry.node.parentNode)) settle(entry);
}

function settleAfterPaint() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => setTimeout(settleTouched, 0));
}

function startObserving() {
  if (resizes || typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") return;
  resizes = new ResizeObserver((entries) => {
    for (const entry of entries) touched.add(entry.target);
    settleTouched();
  });
  mutations = new MutationObserver((records) => {
    for (const record of records) touched.add(record.target);
    settleAfterPaint();
  });
  mutations.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style", "class"] });
}

function stopObserving() {
  resizes?.disconnect();
  mutations?.disconnect();
  resizes = null;
  mutations = null;
  parents.clear();
  touched.clear();
}

function holdParent(parent: Element) {
  const count = parents.get(parent) ?? 0;
  parents.set(parent, count + 1);
  if (!count) resizes?.observe(parent);
}

function releaseParent(parent: Element) {
  const count = parents.get(parent) ?? 0;
  if (count > 1) return void parents.set(parent, count - 1);
  parents.delete(parent);
  if (!watched.has(parent as unknown as Mounted)) resizes?.unobserve(parent);
}

export function watchLayout(node: Mounted | null, handler: () => LayoutHandler | undefined, viewport: Viewport) {
  if (!node) return () => {};
  const entry: Watched = { node, handler, viewport, last: null };
  settle(entry);
  watched.set(node, entry);
  startObserving();
  const element = node as unknown as Element;
  const parent = isElement(node.parentNode) ? (node.parentNode as unknown as Element) : null;
  resizes?.observe(element);
  if (parent) holdParent(parent);
  return () => {
    if (watched.get(node) !== entry) return;
    watched.delete(node);
    if (!parents.has(element)) resizes?.unobserve(element);
    if (parent) releaseParent(parent);
    if (!watched.size) stopObserving();
  };
}
