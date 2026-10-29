import type { ConfirmOptions, PromptOptions } from "../../../packages/shell/src/dialogs";
import { ardiaHost, hostModuleMethod, invokeHost, type ArdiaHost } from "./host";

type Confirmation = { confirmed: boolean; suppressed: boolean };
type DialogResult = Confirmation | string | null;
type PendingDialog = {
  kind: "confirm" | "prompt";
  suppression: boolean;
  accepted: boolean;
  received: boolean;
  generation?: string;
  begun: boolean;
  result?: DialogResult;
  settled: Promise<DialogResult>;
  resolve(result: DialogResult): void;
  reject(error: unknown): void;
  detach(): void;
};
export type DialogSuspension = { readonly settled: Promise<void> };

const MAX_PENDING = 16;
const MAX_SUSPENSIONS = 64;
const decimal = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
const failure = (message: string) => Object.assign(new Error(message), { code: "ERR_DIALOG" });
const canceled = (kind: PendingDialog["kind"]): DialogResult => kind === "confirm" ? { confirmed: false, suppressed: false } : null;

export function createHostDialogs(host: ArdiaHost, newId = () => `dialog:${crypto.randomUUID()}`) {
  const windowId = host.bootstrap.windowId;
  const pending = new Map<string, PendingDialog>();
  let retired = false;
  const suspensions = new Set<DialogSuspension>();
  let suspensionsExhausted = false;
  let sequence = 0;

  const cancelNative = (id: string) => { void invokeHost("ArdiaShell.cancelDialog", { args: [id] }, host).catch(() => {}); };
  const release = (id: string, entry: PendingDialog) => {
    if (pending.get(id) !== entry) return false;
    pending.delete(id);
    entry.detach();
    return true;
  };
  const cancelEntry = (id: string, entry: PendingDialog) => {
    if (!release(id, entry)) return;
    if (entry.begun) cancelNative(id);
    entry.resolve(canceled(entry.kind));
  };
  const finish = (id: string, entry: PendingDialog) => {
    if (pending.get(id) !== entry || !entry.accepted || !entry.received) return;
    release(id, entry);
    entry.resolve(entry.result!);
  };
  const unsubscribe = host.onEvent((module, event, payload) => {
    if (module !== "ArdiaShell" || event !== "shell" || retired) return;
    const envelope = payload as { name?: string; data?: Record<string, unknown> } | null;
    if (envelope?.name !== "shell.dialogResolved") return;
    const data = envelope.data;
    if (!data || data.windowId !== windowId || !decimal(data.rendererGeneration) || typeof data.dialogId !== "string") return;
    const entry = pending.get(data.dialogId);
    if (!entry || !entry.begun || entry.generation !== data.rendererGeneration || entry.received) return;
    const value = data.result;
    if (entry.kind === "confirm") {
      const result = value as Partial<Confirmation> | null;
      if (!result || typeof result.confirmed !== "boolean" || typeof result.suppressed !== "boolean") return;
      entry.result = { confirmed: result.confirmed, suppressed: entry.suppression && result.suppressed };
    } else {
      if (value !== null && typeof value !== "string") return;
      entry.result = typeof value === "string" ? value.trim() || null : null;
    }
    entry.received = true;
    finish(data.dialogId, entry);
  });
  let removeBeforeClose: (() => void) | undefined;
  const retire = () => {
    if (retired) return;
    retired = true;
    unsubscribe();
    removeBeforeClose?.();
    for (const [id, entry] of [...pending]) cancelEntry(id, entry);
  };
  removeBeforeClose = host.onBeforeClose?.(retire);
  const suspend = (): DialogSuspension => {
    const entries = [...pending];
    const current: DialogSuspension = Object.freeze({ settled: Promise.allSettled(entries.map(([, entry]) => entry.settled)).then(() => undefined) });
    if (suspensions.size >= MAX_SUSPENSIONS) suspensionsExhausted = true;
    else suspensions.add(current);
    for (const [id, entry] of entries) cancelEntry(id, entry);
    return current;
  };
  const resume = (token: unknown) => {
    if (retired) return false;
    return suspensions.delete(token as DialogSuspension);
  };

  const begin = (kind: PendingDialog["kind"], options: ConfirmOptions | PromptOptions, signal?: AbortSignal): Promise<DialogResult> => {
    if (retired) return Promise.reject(failure("The dialog renderer is unavailable"));
    if (suspensionsExhausted || suspensions.size) return Promise.reject(failure("Dialogs are suspended for this window"));
    if (!options || typeof options.title !== "string" || options.title.length > 4096 || (options.windowId !== undefined && options.windowId !== windowId)) return Promise.reject(failure("Invalid dialog owner or title"));
    if (signal !== undefined && !(signal instanceof AbortSignal)) return Promise.reject(failure("Invalid abort signal"));
    if (signal?.aborted) return Promise.resolve(canceled(kind));
    if (pending.size >= MAX_PENDING) return Promise.reject(failure("Too many pending dialogs"));
    if (sequence === Number.MAX_SAFE_INTEGER) return Promise.reject(failure("Dialog identities exhausted"));
    const id = `${newId()}:${++sequence}`;
    if (!/^[A-Za-z0-9:_-]{16,96}$/.test(id) || pending.has(id)) return Promise.reject(failure("Invalid or duplicate dialog identity"));
    let resolve!: PendingDialog["resolve"], reject!: PendingDialog["reject"];
    const settled = new Promise<DialogResult>((yes, no) => { resolve = yes; reject = no; });
    const entry: PendingDialog = { kind, suppression: kind === "confirm" && typeof (options as ConfirmOptions).suppression === "string", accepted: false, received: false, begun: false, settled, resolve, reject, detach() {} };
    const request = { dialogId: id, kind, options: { ...options } };
    pending.set(id, entry);
    if (signal) {
      const abort = () => cancelEntry(id, entry);
      signal.addEventListener("abort", abort, { once: true });
      entry.detach = () => signal.removeEventListener("abort", abort);
    }
    const register = async () => {
      const identity = await hostModuleMethod("ArdiaShell", "windowIdentity", host)() as { windowId?: unknown; rendererGeneration?: unknown } | null;
      if (retired || pending.get(id) !== entry) return;
      if (!identity || typeof identity !== "object" || Array.isArray(identity) || identity.windowId !== windowId || !decimal(identity.rendererGeneration)) throw failure("Invalid native dialog window identity");
      entry.generation = identity.rendererGeneration;
      await Promise.resolve();
      if (retired || pending.get(id) !== entry) return;
      entry.begun = true;
      const reply = await host.invoke("ArdiaShell.beginDialog", { args: [request] });
      if (retired || pending.get(id) !== entry) return;
      if (!reply || typeof reply !== "object" || !("accepted" in reply) || reply.accepted !== true) throw failure("The native dialog was not accepted");
      entry.accepted = true;
      finish(id, entry);
    };
    void register().catch((error: unknown) => {
      if (!release(id, entry)) return;
      if (entry.begun) cancelNative(id);
      entry.reject(error);
    });
    return settled;
  };
  return {
    confirm: (options: ConfirmOptions) => begin("confirm", options) as Promise<Confirmation>,
    prompt: (options: PromptOptions) => begin("prompt", options) as Promise<string | null>,
    abortableConfirm: (options: ConfirmOptions, signal: AbortSignal) => begin("confirm", options, signal) as Promise<Confirmation>,
    abortablePrompt: (options: PromptOptions, signal: AbortSignal) => begin("prompt", options, signal) as Promise<string | null>,
    suspend,
    resume,
    retire,
  };
}

let dialogs: ReturnType<typeof createHostDialogs> | undefined;
export const linuxHostDialogs = () => dialogs ??= createHostDialogs(ardiaHost!);
