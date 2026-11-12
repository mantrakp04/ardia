import { useLayoutEffect, useRef } from "react";
import type { BarEvent, Selection, SelectionTracker } from "./barText";

const RESTORE_ECHO_MS = 150;
const RESTORE_ECHOES = 2;

export function usePreviewSelection({
  previewing,
  value,
  typed,
  shownCompletion,
  suppressCompletion,
  selection,
  dispatch,
}: {
  previewing: boolean;
  value: string;
  typed: string;
  shownCompletion: string;
  suppressCompletion: boolean;
  selection: SelectionTracker;
  dispatch(e: BarEvent): void;
}) {
  const echoes = useRef({ until: 0, left: 0 });
  const entered = useRef<{ selection: Selection; typed: string } | null>(null);
  const previewShown = previewing ? value : null;
  const before = useRef(previewShown);
  useLayoutEffect(() => {
    const was = before.current;
    before.current = previewShown;
    if (previewShown !== null) {
      if (was === null) entered.current = { selection: selection.current, typed };
      return dispatch({ kind: "select", selection: { start: previewShown.length, end: previewShown.length } });
    }
    const entry = entered.current;
    entered.current = null;
    if (was === null) return;
    const completion = shownCompletion && !suppressCompletion ? { start: typed.length, end: value.length } : null;
    const restored = completion ?? (entry && entry.typed === typed && !shownCompletion ? entry.selection : null);
    if (!restored) return;
    echoes.current = { until: Date.now() + RESTORE_ECHO_MS, left: was === value ? 0 : RESTORE_ECHOES };
    dispatch({ kind: "select", selection: restored });
  }, [previewShown]);

  return {
    settle() {
      echoes.current.left = 0;
    },
    edited() {
      echoes.current.left = 0;
      entered.current = null;
    },
    isRestoreEcho(next: Selection) {
      const pending = echoes.current;
      if (pending.left <= 0 || Date.now() >= pending.until || next.start !== value.length || next.end !== value.length) return false;
      pending.left -= 1;
      return true;
    },
  };
}
