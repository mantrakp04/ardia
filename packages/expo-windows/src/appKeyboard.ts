type TakesKeyboard = { takeKeyboardFromPage(windowId: string): Promise<boolean> | boolean };
type Fiber = { return: Fiber | null; memoizedProps?: unknown };
type FocusedField = { field: unknown; windowId: string; tabId?: string } | null;
type FieldPlace = { windowId: string; tabId: string };

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

export function fieldFocusedIn(windowId: string, forTab = ""): boolean {
  const focused = readFocusedField();
  if (!focused || (focused.windowId && focused.windowId !== windowId)) return false;
  if (forTab && focused.tabId && focused.tabId !== forTab) return false;
  return pressedOver.get(windowId) !== focused.field;
}

export function noteFieldAsked(windowId: string) {
  if (windowId) pressedOver.delete(windowId);
  else pressedOver.clear();
}

export function placeOfField(field: unknown): FieldPlace {
  let fiber = (field as { __internalInstanceHandle?: Fiber | null } | null)?.__internalInstanceHandle ?? null;
  const place = { windowId: "", tabId: "" };
  for (let steps = 0; fiber && steps < MOST_ANCESTORS; steps++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (!props || typeof props !== "object") continue;
    const { windowId, tabId } = props as { windowId?: unknown; tabId?: unknown };
    if (typeof windowId === "string" && windowId) place.windowId = windowId;
    if (!place.tabId && typeof tabId === "string" && tabId) place.tabId = tabId;
  }
  return place;
}

export const windowIdOfField = (field: unknown) => placeOfField(field).windowId;

export function takeKeyboardFor(native: TakesKeyboard, windowId: string): Promise<boolean> {
  if (!windowId) return Promise.resolve(false);
  return Promise.resolve()
    .then(() => native.takeKeyboardFromPage(windowId))
    .then(
      (moved) => moved === true,
      () => false,
    );
}
