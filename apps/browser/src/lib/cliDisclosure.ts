import { createStore, type StoreApi } from "zustand/vanilla";

export const CLI_DISCLOSURE_HOLD_MS = 3000;

export type CliDisclosureInput = { on: boolean; controlled: boolean };

export type CliDisclosure = {
  update(input: CliDisclosureInput): void;
  dispose(): void;
  readonly shown: boolean;
};

export function createCliDisclosure(onChange: (shown: boolean) => void, holdMs = CLI_DISCLOSURE_HOLD_MS): CliDisclosure {
  let shown = false;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelHide = () => {
    if (hideTimer === null) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  };
  const set = (next: boolean) => {
    if (next === shown) return;
    shown = next;
    onChange(next);
  };
  return {
    update({ on, controlled }) {
      if (!on) {
        cancelHide();
        set(false);
        return;
      }
      if (controlled) {
        cancelHide();
        set(true);
        return;
      }
      if (!shown || hideTimer !== null) return;
      hideTimer = setTimeout(() => {
        hideTimer = null;
        set(false);
      }, holdMs);
    },
    dispose: cancelHide,
    get shown() {
      return shown;
    },
  };
}

export type CliServerSnapshot = { server: { state: string; connections?: number } | null };

export type CliDisclosureState = { shown: boolean };

export type CliServerSource = {
  getState(): CliServerSnapshot;
  subscribe(listener: (state: CliServerSnapshot) => void): () => void;
};

export type CliDisclosureStore = StoreApi<CliDisclosureState> & { dispose(): void };

export const cliDisclosureInput = ({ server }: CliServerSnapshot): CliDisclosureInput => ({
  on: server?.state === "on",
  controlled: server?.state === "on" && (server.connections ?? 0) > 0,
});

export function createCliDisclosureStore(source: CliServerSource, holdMs = CLI_DISCLOSURE_HOLD_MS): CliDisclosureStore {
  const store = createStore<CliDisclosureState>(() => ({ shown: false }));
  const disclosure = createCliDisclosure((shown) => store.setState({ shown }), holdMs);
  disclosure.update(cliDisclosureInput(source.getState()));
  const unsubscribe = source.subscribe((state) => disclosure.update(cliDisclosureInput(state)));
  return Object.assign(store, {
    dispose() {
      unsubscribe();
      disclosure.dispose();
    },
  });
}
