type TakesKeyboard = { takeKeyboardFromPage(): Promise<boolean> | boolean };

let fieldFocused = false;

export const appFieldFocused = () => fieldFocused;

export function noteAppFieldFocused(focused: boolean) {
  fieldFocused = focused;
}

export function takeKeyboardFor(native: TakesKeyboard, refocus: () => void): Promise<void> {
  return Promise.resolve()
    .then(() => native.takeKeyboardFromPage())
    .then(
      (moved) => {
        if (moved) refocus();
      },
      () => {},
    );
}
