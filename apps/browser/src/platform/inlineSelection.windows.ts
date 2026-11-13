import type { TextInput } from "react-native";

export function selectInlineCompletion(input: TextInput | null, start: number, end: number) {
  input?.setSelection(start, end);
}
