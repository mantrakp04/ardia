export type EscapePressedIn = "page" | "window" | "blankBar";

const none = (): Record<EscapePressedIn, number> => ({ page: 0, window: 0, blankBar: 0 });

let closes = none();

export function noteLittleArdiaEscapeClose(pressedIn: EscapePressedIn) {
  closes[pressedIn]++;
}

export function takeLittleArdiaEscapeCloses() {
  const taken = closes;
  closes = none();
  return {
    little_ardia_escape_closes: taken.page,
    little_ardia_escape_closes_unfocused: taken.window,
    little_ardia_escape_closes_blank: taken.blankBar,
  };
}
