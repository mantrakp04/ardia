const closing = new Set<string>();

export const isWindowClosing = (windowId: string) => closing.has(windowId);
export const startClosingWindow = (windowId: string) => void closing.add(windowId);
export const stopClosingWindow = (windowId: string) => closing.delete(windowId);
