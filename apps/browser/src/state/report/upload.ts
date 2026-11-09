import type { ReportFile } from "./form";

export type FailedStage = "create" | "upload" | "complete";

export type Created = { id: string; name: string | null; token: string; uploadUrls: Record<string, string>; uploaded: string[] };

export type Sent = { id: string; name: string | null; issueUrl: string | null; issueNumber: number | null; uploadMs: number; bytes: number };

export type UploadState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "uploading"; created: Created; file: string; sent: number; total: number }
  | { phase: "completing"; created: Created }
  | { phase: "sent"; sent: Sent }
  | { phase: "failed"; stage: FailedStage; message: string; created: Created | null };

export type JsonReply = { status: number; json: unknown };

export type UploadDeps = {
  postJson(url: string, body: unknown, headers: Record<string, string>): Promise<JsonReply>;
  putFile(id: string, url: string, headers: Record<string, string>, file: ReportFile): Promise<number>;
  onProgress(handler: (id: string, sent: number) => void): () => void;
  now(): number;
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

const failure = (stage: FailedStage, message: string, created: Created | null): UploadState => ({ phase: "failed", stage, message, created });

const statusMessage = (status: number, json: unknown) => {
  const error = text(object(json).error) ?? text(object(json).message);
  if (status === 0) return "Couldn't reach Ardia. Check your connection and try again.";
  return error ? `The server said: ${error}` : `The server answered ${status}.`;
};

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
  let created = resume;
  if (!created) {
    onState({ phase: "creating" });
    let reply: JsonReply;
    try {
      reply = await deps.postJson(endpoint.url, payload, { [endpoint.keyHeader]: endpoint.key });
    } catch {
      reply = { status: 0, json: null };
    }
    if (isCancelled()) return finish({ phase: "idle" });
    const answer = object(reply.json);
    const id = text(answer.id);
    const token = text(answer.upload_token);
    if (reply.status < 200 || reply.status >= 300 || !id || (files.length > 0 && !token)) return finish(failure("create", statusMessage(reply.status, reply.json), null));
    created = { id, name: text(answer.name), token: token ?? "", uploadUrls: uploadUrlsFrom(reply.json, endpoint.url, id, files), uploaded: [] };
  }
  const auth = { Authorization: `Bearer ${created.token}`, [endpoint.keyHeader]: endpoint.key };
  let done = files.filter((f) => created!.uploaded.includes(f.name)).reduce((sum, f) => sum + f.bytes, 0);
  for (const file of files) {
    if (created.uploaded.includes(file.name)) continue;
    const at = { phase: "uploading" as const, created, file: file.name, sent: done, total };
    onState(at);
    const stop = deps.onProgress((id, sent) => id === file.name && onState({ ...at, sent: done + Math.min(sent, file.bytes) }));
    let status = 0;
    try {
      status = await deps.putFile(file.name, created.uploadUrls[file.name] ?? reportPath(endpoint.url, created.id, `files/${file.name}`), auth, file);
    } finally {
      stop();
    }
    if (isCancelled()) return finish({ phase: "idle" });
    if (status < 200 || status >= 300) return finish(failure("upload", statusMessage(status, null), created));
    done += file.bytes;
    created = { ...created, uploaded: [...created.uploaded, file.name] };
  }
  onState({ phase: "completing", created });
  let reply: JsonReply;
  try {
    reply = await deps.postJson(reportPath(endpoint.url, created.id, "complete"), {}, auth);
  } catch {
    reply = { status: 0, json: null };
  }
  if (isCancelled()) return finish({ phase: "idle" });
  if (reply.status < 200 || reply.status >= 300) return finish(failure("complete", statusMessage(reply.status, reply.json), created));
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
    },
  });
}

export function uploadFraction(state: UploadState): number {
  if (state.phase === "uploading") return state.total > 0 ? state.sent / state.total : 1;
  if (state.phase === "completing" || state.phase === "sent") return 1;
  return 0;
}

export const isBusy = (state: UploadState) => state.phase === "creating" || state.phase === "uploading" || state.phase === "completing";
