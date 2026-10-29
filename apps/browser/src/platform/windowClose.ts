export type ManagedCloseReason = "window" | "lastTab";
type ManagedWindowClose = (windowId: string, reason: ManagedCloseReason) => boolean;

let managedClose: ManagedWindowClose = () => false;

export const setManagedWindowClose = (close: ManagedWindowClose) => void (managedClose = close);
export const managesWindowClose = (windowId: string, reason: ManagedCloseReason) => managedClose(windowId, reason);
