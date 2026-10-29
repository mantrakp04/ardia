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
