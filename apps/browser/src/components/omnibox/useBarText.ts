import { useReducer, useState } from "react";
import { savedNtpQuery } from "../../state/omnibox/barState";
import { barReducer, initialBar, selectionTracker } from "./barText";

export function useBarText(hero: boolean, tabId: string, initialText: string, noneSelected: number) {
  const [start] = useState(() => {
    const restored = hero ? savedNtpQuery(tabId) : null;
    const bar = initialBar(restored, initialText, noneSelected);
    return { bar, selection: selectionTracker(restored?.selection ?? { start: 0, end: bar.typed.length }) };
  });
  const [state, dispatch] = useReducer(barReducer, start.bar);
  return { ...state, dispatch, selection: start.selection };
}
