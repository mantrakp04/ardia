import type { ArdiaHost } from "./host";
import { enqueueTab } from "./hostTabQueue.ts";
import { queueTabPresentation } from "./hostTabPresentations.ts";
import { hostProfile, invokeHost } from "./host.ts";

export type HostTabEvent = { type: string; [key: string]: unknown };
export type HostTabIdentity = { browserId: number; chromeTabId: number; state?: unknown };
export type HostTabOptions = { key: string; profile?: string; url?: string; adoptId?: string; temporary?: boolean };
export type HostPageReceiver = {
  receive(module: string, id: string, payload: unknown): boolean;
  install(value: unknown): boolean;
  captureRequest(): (() => boolean) | null;
  dispose(): void;
};
export type HostPageFactory = (claim: string, nativeId: () => number | undefined,
  rebound: (identity: { browserId: number; chromeTabId: number }) => void) => HostPageReceiver;
export type TabViewport = { rect: { x: number; y: number; width: number; height: number }; visible: boolean };

const claims = new WeakMap<ArdiaHost, Map<string, HostTab>>();
const UNORDERED_COMMANDS = new Set(["downloadFavicon", "webStoreRequest", "captureViewport"]);

export class HostTab {
  host: ArdiaHost;
  key: string;
  claim = crypto.randomUUID();
  ready: Promise<HostTabIdentity>;
  identity: HostTabIdentity | undefined;
  disposed = false;
  unsubscribe: () => void;
  lastViewport = "";
  releaseScheduled = false;
  page: HostPageReceiver | undefined;

  constructor(host: ArdiaHost, options: HostTabOptions, onEvent: (event: HostTabEvent) => void, page?: HostPageFactory) {
    this.host = host;
    this.key = options.key;
    this.page = page?.(this.claim, () => this.identity?.browserId, (identity) => {
      if (this.disposed || !this.identity || claims.get(host)?.get(this.key) !== this) return;
      this.identity = { ...this.identity, browserId: identity.browserId, chromeTabId: identity.chromeTabId };
      this.lastViewport = "";
    });
    const owners = claims.get(host) ?? new Map<string, HostTab>();
    claims.set(host, owners);
    const early: { id: string; event: HostTabEvent }[] = [];
    const deliver = (event: HostTabEvent) => {
      try { onEvent(event); } catch (error) { console.error("[ardia host] tab listener failed", error); }
    };
    this.unsubscribe = host.onEvent((module, id, payload) => {
      if (this.disposed || (this.identity && owners.get(this.key) !== this)) return;
      if (this.page) {
        this.page.receive(module, id, payload);
        return;
      }
      if (module !== "ArdiaWebView" || !payload || typeof payload !== "object" || !("type" in payload)) return;
      const event = payload as HostTabEvent;
      if (!this.identity) {
        if (early.length === 128) early.shift();
        early.push({ id, event });
      } else if (id === String(this.identity.browserId)) deliver(event);
    });
    this.ready = enqueueTab(host, this.key, async () => {
      const previousClaim = owners.get(this.key)?.claim;
      const identity = await invokeHost<HostTabIdentity>("tab.create", {
        ...options, claim: this.claim, ...(previousClaim ? { previousClaim } : {}), profile: hostProfile(options.profile, host), url: options.url ?? "about:blank",
      }, host);
      if (!Number.isInteger(identity?.browserId) || identity.browserId <= 0 || !Number.isInteger(identity.chromeTabId) || identity.chromeTabId <= 0) throw new Error("Invalid Ardia tab identity");
      this.identity = identity;
      owners.set(this.key, this);
      if (this.disposed) this.detach();
      else if (owners.get(this.key) === this && this.page) {
        if (!this.page.install(identity)) {
          this.page.dispose();
          this.disposed = true;
          this.unsubscribe();
          this.detach();
          throw new Error("Invalid Ardia page lease");
        }
        deliver({ type: "ready", browserId: identity.browserId, chromeTabId: identity.chromeTabId });
      } else if (owners.get(this.key) === this) {
        deliver({ type: "ready", ...identity });
        if (identity.state) deliver({ type: "navigation", state: identity.state });
        for (const queued of early) if (queued.id === String(identity.browserId) && queued.event.type !== "ready") deliver(queued.event);
      }
      early.length = 0;
      return identity;
    }).catch((error) => {
      early.length = 0;
      this.unsubscribe();
      if (owners.get(this.key) === this && !this.releaseScheduled) owners.delete(this.key);
      throw error;
    });
  }

  async command<T = unknown>(command: string, args: unknown[] = []): Promise<T> {
    await this.ready;
    const send = async () => {
      if (this.disposed || !this.identity || claims.get(this.host)?.get(this.key) !== this) throw new Error(`Ardia tab released: ${this.key}`);
      return invokeHost<T>("tab.command", { id: this.identity.browserId, claim: this.claim, command, args }, this.host);
    };
    return UNORDERED_COMMANDS.has(command) ? send() : enqueueTab(this.host, this.key, send);
  }

  async pageResult<T = unknown>(command: string, args: unknown[] = []): Promise<T | null> {
    await this.ready;
    const current = this.disposed ? null : this.page?.captureRequest() ?? null;
    if (!current) return null;
    const result = await this.command<T>(command, args);
    return current() ? result : null;
  }

  presentation(visible: boolean): Promise<void> {
    return queueTabPresentation(this, visible, () => claims.get(this.host)?.get(this.key) === this);
  }

  viewport(viewport: TabViewport) {
    return enqueueTab(this.host, this.key, async () => {
      if (this.disposed || !this.identity || claims.get(this.host)?.get(this.key) !== this) return;
      const json = JSON.stringify(viewport);
      if (json === this.lastViewport) return;
      this.lastViewport = json;
      return invokeHost<void>("tab.viewport", { id: this.identity.browserId, claim: this.claim, ...viewport }, this.host).catch((error) => {
        if (this.lastViewport === json) this.lastViewport = "";
        throw error;
      });
    });
  }

  detach() {
    if (this.releaseScheduled) return;
    this.releaseScheduled = true;
    void enqueueTab(this.host, this.key, async () => {
      const owners = claims.get(this.host);
      if (!this.identity || owners?.get(this.key) !== this) return;
      await invokeHost("tab.release", { id: this.identity.browserId, claim: this.claim }, this.host);
      if (owners.get(this.key) === this) owners.delete(this.key);
    }).catch((error) => {
      this.releaseScheduled = false;
      console.error("[ardia host] release failed", error);
    });
  }

  dispose() {
    this.disposed = true;
    this.page?.dispose();
    this.unsubscribe();
    this.detach();
  }
}
