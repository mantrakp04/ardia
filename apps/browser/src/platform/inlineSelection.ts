import type { TextInput } from "react-native";

export type Caret = { start: number; end: number };

export function selectInlineCompletion(_input: TextInput | null, _start: number, _end: number) {}

export const caretAllowsInline = (_caret: Caret, _typedLength: number) => true;
