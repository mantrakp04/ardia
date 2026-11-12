import { nativeModule } from "@ardia/shell";

const Focus = nativeModule("ArdiaFocus");

export const setSwitcherCapture = (active: boolean) => Focus.setSwitcherCapture(active);
const escapeOwners = new Set<string>();

export function captureEscape(owner: string, active: boolean) {
  const was = escapeOwners.size > 0;
  if (active) escapeOwners.add(owner);
  else escapeOwners.delete(owner);
  const now = escapeOwners.size > 0;
  if (now !== was) void Focus.setDragEscapeCapture(now);
}
export const cancelFocusMove = (generation: number, restoringSource: boolean) => void Focus.cancelFocusMove(generation, restoringSource);
export const claimFocus = (generation: number, tag: number) => void Focus.claimFocus(generation, tag);
export const saveKeyResponder = (windowId: string): Promise<number> => Focus.saveKeyResponder(windowId);
export const restoreKeyResponder = (token: number): Promise<boolean> => (token ? Focus.restoreKeyResponder(token) : Promise.resolve(false));
export const discardKeyResponder = (token: number): void => {
  if (token) void Focus.discardKeyResponder(token);
};
export const switcherPointerMoved = () => Focus.switcherPointerMoved();
