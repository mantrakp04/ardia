import type { ArdiaHost } from "./host";
import { hostProfile, hostSupports, invokeHost } from "./host.ts";

export type ExtensionViewKind = "popup" | "sidePanel";
export type ExtensionViewEvent = { type: string; [key: string]: unknown };
export type ExtensionViewport = { rect: { x: number; y: number; width: number; height: number }; visible: boolean };
export type ExtensionViewOptions = { kind: ExtensionViewKind; url: string; profile?: string };

export const EXTENSION_VIEW_MODULE = "ArdiaExtensionView";

export type FocusWitness = { current: () => readonly unknown[]; now: () => number };
type FocusRequest = { owner: readonly unknown[]; at: number };

export const DEFERRED_FOCUS_MS = 1500;

const shellFocus: FocusWitness = {
  current: () => (typeof document === "undefined" ? [] : [document.activeElement, document.hasFocus()]),
  now: () => performance.now(),
};

export const extensionViewsSupported = (host?: ArdiaHost) => !!host && hostSupports("extensionView.create", host);

export class HostExtensionView {
  host: ArdiaHost;
  ready: Promise<number>;
  id: number | undefined;
  disposed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private lastViewport = "";
  private shown = false;
  private focusWanted: FocusRequest | null = null;
  private focus: FocusWitness;
  private unsubscribe: () => void;

  constructor(host: ArdiaHost, options: ExtensionViewOptions, onEvent: (event: ExtensionViewEvent) => void, focus: FocusWitness = shellFocus) {
    this.host = host;
    this.focus = focus;
    const early: { id: string; event: ExtensionViewEvent }[] = [];
    const deliver = (event: ExtensionViewEvent) => {
      try { onEvent(event); } catch (error) { console.error("[ardia host] extension view listener failed", error); }
    };
    this.unsubscribe = host.onEvent((module, id, payload) => {
      if (this.disposed || module !== EXTENSION_VIEW_MODULE || !payload || typeof payload !== "object" || !("type" in payload)) return;
      const event = payload as ExtensionViewEvent;
      if (this.id === undefined) {
        if (early.length === 64) early.shift();
        early.push({ id, event });
      } else if (id === String(this.id)) deliver(event);
    });
    this.ready = this.enqueue(async () => {
      const reply = await invokeHost<{ id: number }>("extensionView.create", { kind: options.kind, url: options.url, profile: hostProfile(options.profile, host) }, host);
      if (!Number.isInteger(reply?.id) || reply.id <= 0) throw new Error("Invalid Ardia extension view identity");
      this.id = reply.id;
      if (!this.disposed) for (const queued of early) if (queued.id === String(reply.id)) deliver(queued.event);
      early.length = 0;
      if (this.disposed) await this.release();
      return reply.id;
    });
    this.ready.catch(() => {
      early.length = 0;
      this.unsubscribe();
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private release() {
    const id = this.id;
    if (id === undefined) return Promise.resolve();
    this.id = undefined;
    return invokeHost<void>("extensionView.release", { id }, this.host);
  }

  async command<T = unknown>(command: string, args: unknown[] = []): Promise<T> {
    await this.ready;
    return this.enqueue(async () => {
      if (this.disposed || this.id === undefined) throw new Error("Ardia extension view released");
      if (command === "focus" && !this.shown) {
        this.focusWanted = { owner: this.focus.current(), at: this.focus.now() };
        return undefined as T;
      }
      return invokeHost<T>("extensionView.command", { id: this.id, command, args }, this.host);
    });
  }

  viewport(viewport: ExtensionViewport) {
    return this.enqueue(async () => {
      if (this.disposed || this.id === undefined) return;
      const shown = { rect: viewport.rect, visible: viewport.visible };
      const json = JSON.stringify(shown);
      if (json === this.lastViewport) return;
      this.lastViewport = json;
      await invokeHost<void>("extensionView.viewport", { id: this.id, ...shown }, this.host).catch((error) => {
        if (this.lastViewport === json) this.lastViewport = "";
        throw error;
      });
      this.shown = shown.visible;
      const wanted = this.shown ? this.focusWanted : null;
      if (!wanted) return;
      this.focusWanted = null;
      if (!this.focusStillWanted(wanted)) return;
      await invokeHost<void>("extensionView.command", { id: this.id, command: "focus", args: [] }, this.host);
    });
  }

  private focusStillWanted({ owner, at }: FocusRequest) {
    const now = this.focus.current();
    return this.focus.now() - at <= DEFERRED_FOCUS_MS && now.length === owner.length && now.every((value, i) => value === owner[i]);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    void this.enqueue(() => this.release()).catch((error) => console.error("[ardia host] extension view release failed", error));
  }
}
