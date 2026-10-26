const marked = new WeakSet<object>();

export function markHoverProps<T extends { onMouseEnter: () => void; onMouseLeave: () => void }>(props: T): T {
  if (__DEV__) marked.add(props.onMouseEnter);
  return props;
}

export function isMarkedHover(fn: unknown): boolean {
  return typeof fn === "function" && marked.has(fn);
}
