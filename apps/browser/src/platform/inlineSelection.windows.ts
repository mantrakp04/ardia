import type { TextInput } from "react-native";
import type { Caret } from "./inlineSelection";

export function selectInlineCompletion(input: TextInput | null, start: number, end: number) {
  input?.setSelection(start, end);
}

export const caretAllowsInline = (caret: Caret, typedLength: number) => caret.start === typedLength && caret.end >= typedLength;
