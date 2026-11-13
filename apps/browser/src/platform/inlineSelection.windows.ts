import type { TextInput } from "react-native";

export function selectInlineCompletion(input: TextInput | null, start: number, end: number) {
  input?.setSelection(start, end);
}

export const caretAllowsInline = (start: number, end: number, typedLength: number) => start === typedLength && end >= typedLength;
