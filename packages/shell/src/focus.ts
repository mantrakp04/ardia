export type FocusNative = {
  setSwitcherCapture(active: boolean): Promise<void>;
  setDragEscapeCapture(active: boolean): Promise<void>;
  cancelFocusMove(generation: number, restoringSource: boolean): Promise<void>;
  claimFocus(generation: number, tag: number): Promise<void>;
  saveKeyResponder(windowId: string): Promise<number>;
  restoreKeyResponder(token: number): Promise<boolean>;
  discardKeyResponder(token: number): Promise<void>;
  switcherPointerMoved(): boolean;
};
