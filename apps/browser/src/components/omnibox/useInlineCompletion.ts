import { caretAllowsInline, completeInline, selectInlineCompletion } from "../../state/omnibox/textInput";
import { noteInlineCompletionShown } from "../../state/telemetry/inlineCompletionCounts";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { findNodeHandle, type TextInput } from "react-native";
import { acceptsCompletion, completionToWrite, previewFieldChange, settlesInline, withoutFirst, type EditContext, type FieldChange, type Inline, type PendingInline, type Selection } from "./inline";

export function useInlineCompletion(input: RefObject<TextInput | null>, typed: string, wanted: string, preview: string | null, caret: () => Selection) {
  const [inline, setInline] = useState<Inline | null>(null);
  const pending = useRef<PendingInline[]>([]);
  const heard = useRef(typed);
  const counted = useRef("");
  const shown = inline?.typed === typed ? inline.completion : "";

  useLayoutEffect(() => {
    if (typed !== heard.current) {
      heard.current = typed;
      pending.current = pending.current.map((p) => ({ ...p, orphaned: true }));
    }
    if (preview !== null) return;
    const write = completionToWrite(typed, wanted, shown, pending.current);
    const tag = write && findNodeHandle(input.current);
    if (!write || tag == null) return;
    pending.current = [...pending.current, write];
    const settle = (result: number) => {
      if (result === 2) return;
      pending.current = withoutFirst(pending.current, write);
      const { start, end } = caret();
      if (settlesInline(result === 1, write.completion, caretAllowsInline(start, end, write.typed.length))) setInline(write);
    };
    completeInline(tag, write.typed, write.completion).then(settle, () => settle(0));
  }, [input, typed, wanted, shown, preview]);

  const read = (next: string, edit?: EditContext): FieldChange => {
    const change = previewFieldChange(typed, shown, preview, next, pending.current, edit);
    if (change.echo) {
      pending.current = pending.current.slice(change.settled);
      if (!change.stale) setInline(change.inline);
    } else {
      heard.current = change.typed;
      setInline(null);
    }
    return change;
  };

  useLayoutEffect(() => {
    if (!shown) counted.current = "";
    if (!shown || preview !== null) return;
    selectInlineCompletion(input.current, typed.length, typed.length + shown.length);
    const key = `${typed}\n${shown}`;
    if (counted.current === key) return;
    counted.current = key;
    noteInlineCompletionShown();
  }, [input, typed, shown, preview]);

  const accepts = (selection: Selection) => preview === null && acceptsCompletion(typed, shown, selection, pending.current);

  return { shown, read, accepts };
}
