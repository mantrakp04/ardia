import { Shell } from "./shellNative";

export const setSwitcherCapture = (active: boolean) => void Shell.setSwitcherCapture(active);
export const setDragEscapeCapture = (active: boolean) => void Shell.setDragEscapeCapture(active);
export const cancelFocusMove = (generation: number, restoringSource: boolean) =>
  void Shell.cancelFocusMove(generation, restoringSource);
export const claimFocus = (generation: number, tag: number) => void Shell.claimFocus(generation, tag);
export const saveKeyResponder = (windowId: string): Promise<number> => Shell.saveKeyResponder(windowId);
export const restoreKeyResponder = (token: number): Promise<boolean> => (token ? Shell.restoreKeyResponder(token) : Promise.resolve(false));
export const discardKeyResponder = (token: number): void => {
  if (token) void Shell.discardKeyResponder(token);
};
export const restartSwitcherPointer = () => Shell.setSwitcherCapture(true);
export const switcherPointerMoved = () => Shell.switcherPointerMoved();
