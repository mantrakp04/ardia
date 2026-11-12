import type { ReportFile } from "./form";

export type FailedStage = "create" | "upload" | "complete";

export type FailureClass = "offline" | "storage" | "server" | "rate_limited" | "expired" | "rejected";

export const RETRY_DELAYS_MS = [2_000, 8_000] as const;

export type Created = { id: string; name: string | null; token: string; uploadUrls: Record<string, string>; uploaded: string[] };

export type Sent = { id: string; name: string | null; issueUrl: string | null; issueNumber: number | null; uploadMs: number; bytes: number; retries: number };

export type UploadState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "uploading"; created: Created; file: string; sent: number; total: number }
  | { phase: "completing"; created: Created }
  | { phase: "sent"; sent: Sent }
  | { phase: "failed"; stage: FailedStage; message: string; created: Created | null; errorClass: FailureClass; status: number; attempts: number };

export type JsonReply = { status: number; json: unknown };

export type UploadDeps = {
  postJson(url: string, body: unknown, headers: Record<string, string>): Promise<JsonReply>;
  putFile(id: string, url: string, headers: Record<string, string>, file: ReportFile): Promise<number>;
  onProgress(handler: (id: string, sent: number) => void): () => void;
  now(): number;
  sleep(ms: number): Promise<void>;
};

export type Endpoint = { url: string; key: string; keyHeader: string };

const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

export function resolveUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = /^(https?:\/\/[^/?#]+)/i.exec(base)?.[1] ?? "";
  if (path.startsWith("/")) return `${origin}${path}`;
  return `${base.replace(/[?#].*$/, "").replace(/\/[^/]*$/, "")}/${path}`;
}

export function reportPath(endpoint: string, id: string, suffix: string): string {
  return `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(id)}/${suffix}`;
}

export function uploadUrlsFrom(json: unknown, endpoint: string, id: string, files: ReportFile[]): Record<string, string> {
  const raw = object(json).upload_urls;
  const urls: Record<string, string> = {};
  if (Array.isArray(raw)) {
    raw.forEach((entry, i) => {
      if (typeof entry === "string" && files[i]) urls[files[i]!.name] = resolveUrl(endpoint, entry);
      const named = object(entry);
      const name = text(named.name);
      const url = text(named.url);
      if (name && url) urls[name] = resolveUrl(endpoint, url);
    });
  } else {
    for (const [name, url] of Object.entries(object(raw))) if (typeof url === "string" && url) urls[name] = resolveUrl(endpoint, url);
  }
  for (const file of files) urls[file.name] ??= reportPath(endpoint, id, `files/${encodeURIComponent(file.name)}`);
  return urls;
}

export function issueNumberOf(url: string | null): number | null {
  const match = url ? /\/(?:issues|pull)\/(\d+)/.exec(url) : null;
  return match ? Number(match[1]) : null;
}

export function failureClass(status: number, json: unknown): FailureClass {
  const error = text(object(json).error) ?? "";
  if (status === 0) return "offline";
  if (status === 429) return "rate_limited";
  if (status === 401 && error.startsWith("token_")) return "expired";
  if (status >= 400 && status < 500) return "rejected";
  if (error === "upstream" || error === "upstream:storage") return "storage";
  return "server";
}

export const isRetryable = (errorClass: FailureClass) => errorClass === "offline" || errorClass === "storage" || errorClass === "server";

const sentence = (value: string) => (/[.!?]$/.test(value) ? value : `${value}.`);

export function failureMessage(errorClass: FailureClass, status: number, json: unknown): string {
  switch (errorClass) {
    case "offline":
      return "Couldn't reach Ardia's report server. Check your connection; your draft is kept.";
    case "storage":
      return "Ardia's report server couldn't store this right now. Your draft is kept; try again in a minute.";
    case "server":
      return "Ardia's report server ran into a problem. Your draft is kept; try again in a minute.";
    case "rate_limited":
      return "Ardia's report server has had too many reports from your network. Your draft is kept; try again in an hour.";
    case "expired":
      return "This report waited too long to finish sending. Your draft is kept; Try Again sends it fresh.";
    case "rejected": {
      const reason = text(object(json).message) ?? text(object(json).error);
      return sentence(`Ardia's report server couldn't accept this report (${reason ?? `error ${status}`}). Your draft is kept`);
    }
  }
}

const failure = (stage: FailedStage, reply: JsonReply, attempts: number, created: Created | null): UploadState => {
  const errorClass = failureClass(reply.status, reply.json);
  return { phase: "failed", stage, message: failureMessage(errorClass, reply.status, reply.json), created, errorClass, status: reply.status, attempts };
};

const succeeded = (status: number) => status >= 200 && status < 300;

export async function sendReport(
  deps: UploadDeps,
  endpoint: Endpoint,
  payload: Record<string, unknown>,
  files: ReportFile[],
  onState: (state: UploadState) => void,
  resume: Created | null = null,
  isCancelled: () => boolean = () => false,
): Promise<UploadState> {
  const started = deps.now();
  const total = files.reduce((sum, f) => sum + Math.max(0, f.bytes), 0);
  const finish = (state: UploadState) => (onState(state), state);
  let retries = 0;
  const withRetries = async (call: () => Promise<JsonReply>) => {
    for (let attempts = 1; ; attempts++) {
      const reply = await call().catch((): JsonReply => ({ status: 0, json: null }));
      const delay = RETRY_DELAYS_MS[attempts - 1];
      if (succeeded(reply.status) || delay === undefined || isCancelled() || !isRetryable(failureClass(reply.status, reply.json))) return { reply, attempts };
      retries += 1;
      await deps.sleep(delay);
      if (isCancelled()) return { reply, attempts };
    }
  };
  let created = resume;
  if (!created) {
    onState({ phase: "creating" });
    const { reply, attempts } = await withRetries(() => deps.postJson(endpoint.url, payload, { [endpoint.keyHeader]: endpoint.key }));
    if (isCancelled()) return finish({ phase: "idle" });
    const answer = object(reply.json);
    const id = text(answer.id);
    const token = text(answer.upload_token);
    if (!succeeded(reply.status) || !id || (files.length > 0 && !token)) return finish(failure("create", reply, attempts, null));
    created = { id, name: text(answer.name), token: token ?? "", uploadUrls: uploadUrlsFrom(reply.json, endpoint.url, id, files), uploaded: [] };
  }
  const auth = { Authorization: `Bearer ${created.token}`, [endpoint.keyHeader]: endpoint.key };
  let done = files.filter((f) => created!.uploaded.includes(f.name)).reduce((sum, f) => sum + f.bytes, 0);
  for (const file of files) {
    if (created.uploaded.includes(file.name)) continue;
    const at = { phase: "uploading" as const, created, file: file.name, sent: done, total };
    const url = created.uploadUrls[file.name] ?? reportPath(endpoint.url, created.id, `files/${file.name}`);
    const { reply, attempts } = await withRetries(async () => {
      onState(at);
      const stop = deps.onProgress((id, sent) => id === file.name && onState({ ...at, sent: done + Math.min(sent, file.bytes) }));
      try {
        return { status: await deps.putFile(file.name, url, auth, file), json: null };
      } finally {
        stop();
      }
    });
    if (isCancelled()) return finish({ phase: "idle" });
    if (!succeeded(reply.status)) return finish(failure("upload", reply, attempts, created));
    done += file.bytes;
    created = { ...created, uploaded: [...created.uploaded, file.name] };
  }
  onState({ phase: "completing", created });
  const completeUrl = reportPath(endpoint.url, created.id, "complete");
  const { reply, attempts } = await withRetries(() => deps.postJson(completeUrl, {}, auth));
  if (isCancelled()) return finish({ phase: "idle" });
  if (!succeeded(reply.status)) return finish(failure("complete", reply, attempts, created));
  const answer = object(reply.json);
  const issueUrl = text(answer.issue_url);
  return finish({
    phase: "sent",
    sent: {
      id: text(answer.id) ?? created.id,
      name: text(answer.name) ?? created.name,
      issueUrl,
      issueNumber: typeof answer.issue_number === "number" ? answer.issue_number : issueNumberOf(issueUrl),
      uploadMs: deps.now() - started,
      bytes: total,
      retries,
    },
  });
}

export function uploadFraction(state: UploadState): number {
  if (state.phase === "uploading") return state.total > 0 ? state.sent / state.total : 1;
  if (state.phase === "completing" || state.phase === "sent") return 1;
  return 0;
}

export const isBusy = (state: UploadState) => state.phase === "creating" || state.phase === "uploading" || state.phase === "completing";
