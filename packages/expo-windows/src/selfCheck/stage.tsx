import { Component, useEffect, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { View, type ViewStyle } from "react-native";

const RENDER_DEADLINE_MS = 5000;

type Staged = { turn: number; element: ReactElement; settle(error?: unknown): void };

let staged: Staged | null = null;
let turns = 0;
const watchers = new Set<() => void>();

function show(next: Staged | null) {
  staged = next;
  for (const watcher of watchers) watcher();
}

const watch = (watcher: () => void) => {
  watchers.add(watcher);
  return () => void watchers.delete(watcher);
};

const offToTheSide: ViewStyle = { position: "absolute", left: 0, top: 0, width: 200, height: 40, opacity: 0 };

class CatchRenderError extends Component<{ onError(error: unknown): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Committed({ onCommit }: { onCommit(): void }) {
  useEffect(() => onCommit(), [onCommit]);
  return null;
}

export function SelfCheckStage() {
  const current = useSyncExternalStore(watch, () => staged);
  if (!current) return null;
  return (
    <View pointerEvents="none" style={offToTheSide}>
      <CatchRenderError key={current.turn} onError={current.settle}>
        {current.element}
        <Committed onCommit={current.settle} />
      </CatchRenderError>
    </View>
  );
}

export function renderOnStage(element: ReactElement, what: string): Promise<void> {
  return stage(element, what, false).then(() => {});
}

export function holdOnStage(element: ReactElement, what: string): Promise<() => void> {
  return stage(element, what, true);
}

function stage(element: ReactElement, what: string, held: boolean): Promise<() => void> {
  return new Promise<() => void>((resolve, reject) => {
    let settled = false;
    const turn = turns + 1;
    const release = () => {
      if (staged?.turn === turn) show(null);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!held || error !== undefined) show(null);
      if (error === undefined) resolve(release);
      else reject(new Error(`${what} threw while rendering: ${error instanceof Error ? error.message : String(error)}`));
    };
    const timer = setTimeout(() => finish(`no window rendered it within ${RENDER_DEADLINE_MS} ms`), RENDER_DEADLINE_MS);
    turns = turn;
    show({ turn, element, settle: finish });
  });
}
