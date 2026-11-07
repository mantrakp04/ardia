type OpenPopup = { windowId: string } | null | undefined;
type PopupDismissal = { popup: () => OpenPopup; windowOf: (tabId: string) => string | undefined; close: () => void };

let dismissal: PopupDismissal | null = null;
export const setPopupDismissal = (next: PopupDismissal) => void (dismissal = next);

export function closingPopupOnPageFocus<P extends { tabId?: string; onPageFocus?: () => void }>(
  props: P,
  popup: () => OpenPopup,
  windowOf: (tabId: string) => string | undefined,
  close: () => void,
): P {
  return {
    ...props,
    onPageFocus: () => {
      const open = popup();
      if (open && props.tabId && windowOf(props.tabId) === open.windowId) close();
      props.onPageFocus?.();
    },
  };
}

export const withPopupDismissal = <P extends { tabId?: string; onPageFocus?: () => void }>(props: P) =>
  dismissal ? closingPopupOnPageFocus(props, dismissal.popup, dismissal.windowOf, dismissal.close) : props;
