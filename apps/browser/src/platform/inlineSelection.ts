import type { TextInput } from "react-native";

export function selectInlineCompletion(_input: TextInput | null, _start: number, _end: number) {}

export const caretAllowsInline = (_start: number, _end: number, _typedLength: number) => true;
