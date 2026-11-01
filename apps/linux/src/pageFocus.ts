const listeners = new Set<() => void>();

export function watchPageFocus(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const notingPageFocus = <P extends { onPageFocus?: () => void }>(props: P): P => ({
  ...props,
  onPageFocus: () => {
    for (const listener of [...listeners]) listener();
    props.onPageFocus?.();
  },
});
