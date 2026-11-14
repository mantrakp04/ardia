type TakesKeyboard = { takeKeyboardFromPage(windowId: string): Promise<boolean> | boolean };
type Fiber = { return: Fiber | null; memoizedProps?: unknown };

const MOST_ANCESTORS = 4096;

let fieldFocused = false;
let toldHost: boolean | undefined;

export const appFieldFocused = () => fieldFocused;

export function noteAppFieldFocused(focused: boolean, tellHost: (focused: boolean) => unknown, asked = false) {
  fieldFocused = focused;
  if (!asked && focused === toldHost) return;
  toldHost = focused;
  tellHost(focused);
}

export function windowIdOfField(field: unknown): string {
  let fiber = (field as { __internalInstanceHandle?: Fiber | null } | null)?.__internalInstanceHandle ?? null;
  let found = "";
  for (let steps = 0; fiber && steps < MOST_ANCESTORS; steps++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    const id = props && typeof props === "object" ? (props as { windowId?: unknown }).windowId : undefined;
    if (typeof id === "string" && id) found = id;
  }
  return found;
}

export function takeKeyboardFor(native: TakesKeyboard, windowId: string, refocus: () => void): Promise<void> {
  if (!windowId) return Promise.resolve();
  return Promise.resolve()
    .then(() => native.takeKeyboardFromPage(windowId))
    .then(
      (moved) => {
        if (moved) refocus();
      },
      () => {},
    );
}
