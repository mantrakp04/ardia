type TakesKeyboard = { takeKeyboardFromPage(windowId: string): Promise<boolean> | boolean };
type Fiber = { return: Fiber | null; memoizedProps?: unknown };
type FocusedField = { field: unknown; windowId: string } | null;

const MOST_ANCESTORS = 4096;

let readFocusedField: () => FocusedField = () => null;
const pressedOver = new Map<string, unknown>();

export function readFocusedFieldWith(read: () => FocusedField) {
  readFocusedField = read;
}

export function notePagePressed(windowId: string) {
  const focused = readFocusedField();
  if (focused && (focused.windowId === windowId || !focused.windowId)) pressedOver.set(windowId, focused.field);
}

export function fieldFocusedIn(windowId: string): boolean {
  const focused = readFocusedField();
  if (!focused || (focused.windowId && focused.windowId !== windowId)) return false;
  return pressedOver.get(windowId) !== focused.field;
}

export function noteFieldAsked(windowId: string) {
  if (windowId) pressedOver.delete(windowId);
  else pressedOver.clear();
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

export function takeKeyboardFor(native: TakesKeyboard, windowId: string): Promise<boolean> {
  if (!windowId) return Promise.resolve(false);
  return Promise.resolve()
    .then(() => native.takeKeyboardFromPage(windowId))
    .then(
      (moved) => moved === true,
      () => false,
    );
}
