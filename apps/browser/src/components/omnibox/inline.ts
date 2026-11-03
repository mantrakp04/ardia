
export type Inline = { typed: string; completion: string };

export type PendingInline = Inline & { orphaned?: boolean };

export type FieldChange =
  | {
      echo: false;
      typed: string;
      suppress: boolean;
    }
  | {
      echo: true;
      settled: number;
      inline: Inline;
      stale: boolean;
    };

export type Selection = { start: number; end: number };
export type EditContext = { before: Selection; after: Selection };

export function fieldChange(typed: string, shown: string, next: string, pending: readonly PendingInline[], edit?: EditContext): FieldChange {
  const i = pending.findIndex((p) => next === p.typed + p.completion && (p.orphaned || p.typed === typed));
  if (i >= 0) {
    const { typed: t, completion, orphaned } = pending[i]!;
    return { echo: true, settled: i + 1, inline: { typed: t, completion }, stale: !!orphaned };
  }
  return { echo: false, typed: next, suppress: preventsInline(typed, shown, next, edit) };
}

const length = (s: string) => [...s].length;

function preventsInline(typed: string, shown: string, next: string, edit: EditContext | undefined): boolean {
  const old = typed + shown;
  if (edit) {
    const lo = Math.min(edit.before.start, edit.before.end);
    const hi = Math.max(edit.before.start, edit.before.end);
    if (hi <= old.length) {
      if (next.length < old.length && edit.after.start <= lo) return true;
      const inserted = next.length - (old.length - (hi - lo));
      if (inserted >= 0 && next.startsWith(old.slice(0, lo)) && next.endsWith(old.slice(hi))) return length(next.slice(lo, lo + inserted)) > 1;
    }
  }
  if (next.length > typed.length && next.startsWith(typed)) return length(next.slice(typed.length)) > 1;
  return onlyRemoved(old, next) || length(next) - length(typed) > 1;
}

export function previewFieldChange(typed: string, shown: string, preview: string | null, next: string, pending: readonly PendingInline[], edit?: EditContext): FieldChange {
  const change = fieldChange(typed, shown, next, pending, edit);
  return preview === null || change.echo ? change : fieldChange(preview, "", next, [], edit);
}

export function acceptsCompletion(typed: string, shown: string, selection: Selection, pending: readonly PendingInline[]): boolean {
  return !!shown && pending.length === 0 && selection.start === selection.end && selection.start === typed.length + shown.length;
}

export function completionToWrite(typed: string, wanted: string, shown: string, pending: readonly PendingInline[]): Inline | null {
  const last = pending[pending.length - 1];
  const showing = last && !last.orphaned && last.typed === typed ? last.completion : shown;
  return wanted === showing ? null : { typed, completion: wanted };
}

export function withoutFirst(pending: readonly PendingInline[], inline: Inline): PendingInline[] {
  const i = pending.findIndex((p) => p.typed === inline.typed && p.completion === inline.completion);
  return i < 0 ? [...pending] : [...pending.slice(0, i), ...pending.slice(i + 1)];
}

function onlyRemoved(from: string, next: string): boolean {
  if (next.length >= from.length) return false;
  let head = 0;
  while (head < next.length && next[head] === from[head]) head++;
  let tail = 0;
  while (tail < next.length - head && next[next.length - 1 - tail] === from[from.length - 1 - tail]) tail++;
  return head + tail >= next.length;
}
