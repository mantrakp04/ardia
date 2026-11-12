import { randomUUID } from "node:crypto";
import { UploadSizeError } from "./backends.mjs";
import { APP_INGEST_KEY, CLI_INGEST_KEY, anonymousIdentity } from "./core.mjs";
import { HttpError, rateLimiter, readBody, readJson, sendJson } from "./http.mjs";
import { newId, normalizeId } from "./ids.mjs";
import { scrubForIssue } from "./scrub.mjs";
import { UPLOAD_TOKEN_TTL_MS, bearerToken, issueUploadToken, uploadTokenProblem } from "./tokens.mjs";
import { MAX_JSON_BYTES, attachmentRule, validateReport } from "./validate.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const SURFACE_BY_KEY = new Map([[APP_INGEST_KEY, "app"], [CLI_INGEST_KEY, "cli"]]);
const FILE_ROUTE = /^\/api\/feedback\/([^/]+)\/files\/([^/]+)$/;
const COMPLETE_ROUTE = /^\/api\/feedback\/([^/]+)\/complete$/;
const SERVICE_NAME = "ardia-feedback";
const SERVICE_VERSION = "1.0.0";
const RETRY_AFTER_SECONDS = 60;
export const EVENT_RETRY_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000, 3_600_000, 3_600_000, 3_600_000];

export const UPSTREAM_MESSAGES = {
  storage: "report storage is unavailable; try again in a minute",
  collector: "the event collector is unavailable; try again in a minute",
  issues: "GitHub is unavailable; try again in a minute",
};

export class BackendError extends Error {
  constructor(backend, cause) {
    super(`${backend}: ${cause?.message ?? cause}`, { cause });
    this.backend = backend;
  }
}

const passesThrough = (error) => error instanceof HttpError || error instanceof UploadSizeError || error instanceof BackendError;

export function blame(backend, impl) {
  if (!impl) return impl;
  return Object.fromEntries(Object.entries(impl).map(([name, fn]) => [
    name,
    typeof fn !== "function" || name === "describe"
      ? fn
      : async (...args) => {
        try {
          return await fn(...args);
        } catch (error) {
          throw passesThrough(error) ? error : new BackendError(backend, error);
        }
      },
  ]));
}

export const ISSUE_LABELS = { bug: ["feedback", "bug"], slow: ["feedback", "bug"], idea: ["feedback", "enhancement"], other: ["feedback"] };

const tableCell = (value) => String(value).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");

export function issueFor(report, dashboardUrl) {
  const version = report.source === "cli"
    ? `CLI ${report.cli_version}${report.app_version ? ` (app ${report.app_version})` : ""}`
    : `Ardia ${report.app_version}${report.app_build ? ` (${report.app_build})` : ""}${report.channel ? ` ${report.channel}` : ""}`;
  const rows = [["Kind", report.kind], ["Version", version], ["macOS", report.os_version ?? "unknown"], ["Reference", report.id]];
  const body = [
    scrubForIssue(report.description),
    "",
    "| | |",
    "| --- | --- |",
    ...rows.map(([label, value]) => `| ${label} | ${tableCell(value)} |`),
    "",
    `Sent with Report a Problem. Maintainers: recording, diagnostics and contact are on the [private page](${dashboardUrl}/feedback/${report.id}).`,
  ].join("\n");
  return { title: scrubForIssue(report.title), body, labels: ISSUE_LABELS[report.kind] };
}

function otlpValue(value) {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  if (typeof value === "string") return { stringValue: value };
  return { stringValue: JSON.stringify(value) };
}

export function feedbackEvent(report, { attachments, issue, completedAtMs }) {
  const properties = {
    event: "feedback_submitted",
    uuid: report.uuid,
    distinct_id: report.install_id,
    feedback_id: report.id,
    kind: report.kind,
    title: report.title,
    description: report.description,
    source: report.source,
    install_id: report.install_id,
    $session_id: report.session_id,
    app_version: report.app_version,
    $app_version: report.app_version,
    app_build: report.app_build,
    channel: report.channel,
    os_version: report.os_version,
    arch: report.arch,
    cli_version: report.cli_version,
    contact: report.contact,
    page_address: report.page_address,
    watch_days: report.watch_days,
    watch_until: report.watch_until,
    diagnostics: report.diagnostics,
    attachments,
    attachment_count: attachments.filter((a) => a.received).length,
    has_recording: attachments.some((a) => a.name === "recording.mp4" && a.received),
    has_trace: attachments.some((a) => a.name === "trace.json.gz" && a.received),
    issue_number: issue?.number ?? null,
    issue_url: issue?.url ?? null,
    issue_error: issue?.error ?? null,
    created_at: report.created_at,
    $lib: SERVICE_NAME,
    $geoip_disable: true,
  };
  const attributes = Object.entries(properties)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ({ key, value: otlpValue(value) }));
  return {
    resourceLogs: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: SERVICE_NAME } }, { key: "service.version", value: { stringValue: SERVICE_VERSION } }] },
      scopeLogs: [{
        scope: { name: "ardia.analytics" },
        logRecords: [{ timeUnixNano: `${completedAtMs}000000`, severityNumber: 9, severityText: "INFO", body: { stringValue: "feedback_submitted" }, attributes }],
      }],
    }],
  };
}

const laterTimer = (fn, ms) => setTimeout(fn, ms).unref();

export function createService({ store: rawStore, events: rawEvents, issues: rawIssues, secret, publicUrl, dashboardUrl, rateLimits = true, now = Date.now, log = console.log, later = laterTimer }) {
  const store = blame("storage", rawStore);
  const events = blame("collector", rawEvents);
  const issues = blame("issues", rawIssues);
  const opened = new Map();
  const queuedEvents = new Set();
  const limits = {
    create: rateLimiter({ limit: 10, windowMs: 60 * 60 * 1000, now }),
    createGlobal: rateLimiter({ limit: 300, windowMs: 60 * 60 * 1000, now }),
    upload: rateLimiter({ limit: 120, windowMs: 10 * 60 * 1000, now }),
    complete: rateLimiter({ limit: 30, windowMs: 10 * 60 * 1000, now }),
  };
  const reserved = new Set();
  const completing = new Map();

  const limit = (name, key) => {
    if (rateLimits && !limits[name](key)) throw new HttpError(429, "rate_limited", "too many reports from here; try again later");
  };

  const surfaceOf = (req) => {
    const surface = SURFACE_BY_KEY.get(req.headers["x-ardia-key"]);
    if (!surface) throw new HttpError(403, "bad_key", "X-Ardia-Key is missing or unknown");
    return surface;
  };

  const authorize = async (req, rawId) => {
    const id = normalizeId(rawId);
    if (!id) throw new HttpError(404, "not_found", "no such report");
    const problem = uploadTokenProblem(secret, bearerToken(req.headers.authorization), id, now());
    if (problem) throw new HttpError(401, `token_${problem}`, `upload token ${problem.replace("_", " ")}`);
    const report = await store.readJson(id, "report.json");
    if (!report) throw new HttpError(404, "not_found", "no such report");
    return report;
  };

  async function create(req, res, ip) {
    const surface = surfaceOf(req);
    limit("create", ip);
    const body = await readJson(req, MAX_JSON_BYTES);
    const { report: fields, error } = validateReport(body);
    if (error) throw new HttpError(400, "invalid", error.message);
    if (fields.source !== surface) throw new HttpError(403, "bad_key", `source ${fields.source} needs the ${fields.source} key`);
    limit("createGlobal", "all");
    const id = await newId(async (candidate) => reserved.has(candidate) || (await store.exists(candidate)));
    reserved.add(id);
    try {
      const createdAt = now();
      const expiresAt = createdAt + UPLOAD_TOKEN_TTL_MS;
      const report = {
        id,
        uuid: randomUUID(),
        ingest: surface,
        created_at: new Date(createdAt).toISOString(),
        expires_at: new Date(expiresAt).toISOString(),
        watch_until: fields.watch_days ? new Date(createdAt + fields.watch_days * DAY_MS).toISOString() : null,
        ...fields,
      };
      await store.writeJson(id, "report.json", report);
      const uploadUrls = Object.fromEntries(report.attachments.map((a) => [a.name, `${publicUrl(req)}/api/feedback/${id}/files/${a.name}`]));
      log(`[feedback] ${id} created (${surface}, ${report.kind}, ${report.attachments.length} attachments)`);
      sendJson(res, 201, {
        id,
        name: anonymousIdentity(report.install_id).name,
        upload_token: issueUploadToken(secret, id, expiresAt),
        upload_urls: uploadUrls,
        expires_at: report.expires_at,
      });
    } finally {
      reserved.delete(id);
    }
  }

  async function upload(req, res, ip, rawId, rawName) {
    limit("upload", ip);
    const report = await authorize(req, rawId);
    const name = rawName;
    const declared = attachmentRule(name) && report.attachments.find((a) => a.name === name);
    if (!declared) throw new HttpError(404, "not_declared", `${name} was not listed in attachments`);
    if (await store.readJson(report.id, "complete.json")) throw new HttpError(409, "completed", "report already completed");
    const length = req.headers["content-length"];
    if (length !== undefined && Number(length) !== declared.bytes) {
      throw new HttpError(Number(length) > declared.bytes ? 413 : 400, "size_mismatch", `${name} was declared as ${declared.bytes} bytes`);
    }
    try {
      await store.putFile(report.id, name, req, declared.bytes);
    } catch (error) {
      if (error instanceof UploadSizeError) {
        throw new HttpError(error.received > error.expected ? 413 : 400, "size_mismatch", `${name} was declared as ${declared.bytes} bytes`);
      }
      throw error;
    }
    sendJson(res, 200, { name, bytes: declared.bytes });
  }

  async function markEventSent(id) {
    const done = await store.readJson(id, "complete.json");
    if (done) await store.writeJson(id, "complete.json", { ...done, event_sent: true });
  }

  function retryEvent(report, event, attempt = 0) {
    if (attempt >= EVENT_RETRY_MS.length) {
      queuedEvents.delete(report.id);
      log(`[feedback] ${report.id} event gave up after ${attempt} retries (collector)`);
      return;
    }
    queuedEvents.add(report.id);
    later(async () => {
      try {
        await events.send(report.id, report.ingest, event);
      } catch (error) {
        log(`[feedback] ${report.id} event retry ${attempt + 1} failed (collector): ${error.cause?.message ?? error.message}`);
        return retryEvent(report, event, attempt + 1);
      }
      queuedEvents.delete(report.id);
      log(`[feedback] ${report.id} event sent on retry ${attempt + 1}`);
      await markEventSent(report.id).catch((error) => log(`[feedback] ${report.id} event_sent not saved (storage): ${error.cause?.message ?? error.message}`));
    }, EVENT_RETRY_MS[attempt]);
  }

  async function sendEvent(report, event) {
    try {
      await events.send(report.id, report.ingest, event);
      return true;
    } catch (error) {
      log(`[feedback] ${report.id} event not sent (collector), will retry: ${error.cause?.message ?? error.message}`);
      retryEvent(report, event);
      return false;
    }
  }

  async function openIssue(report) {
    const saved = (await store.readJson(report.id, "issue.json")) ?? opened.get(report.id);
    if (saved || !issues) return saved ?? null;
    let issue;
    try {
      issue = await issues.create(report.id, issueFor(report, dashboardUrl));
    } catch (error) {
      log(`[feedback] ${report.id} issue not opened (issues): ${error.cause?.message ?? error.message}`);
      return { number: null, url: null, error: String(error.cause?.message ?? error.message).slice(0, 200) };
    }
    opened.set(report.id, issue);
    await store.writeJson(report.id, "issue.json", issue);
    opened.delete(report.id);
    return issue;
  }

  async function finish(report) {
    const done = await store.readJson(report.id, "complete.json");
    if (done) {
      if (done.event_sent === false && !queuedEvents.has(report.id)) {
        const issue = { number: done.issue_number ?? null, url: done.issue_url ?? null, error: done.issue_error ?? null };
        const event = feedbackEvent(report, { attachments: done.attachments ?? [], issue, completedAtMs: Date.parse(done.completed_at) || now() });
        if (await sendEvent(report, event)) await markEventSent(report.id);
      }
      return { id: done.id, name: done.name, issue_url: done.issue_url };
    }
    const attachments = await Promise.all(report.attachments.map(async (a) => ({ ...a, received: (await store.fileSize(report.id, a.name)) === a.bytes })));
    const issue = await openIssue(report);
    const completedAt = now();
    const event = feedbackEvent(report, { attachments, issue, completedAtMs: completedAt });
    const answer = { id: report.id, name: anonymousIdentity(report.install_id).name, issue_url: issue?.url ?? null };
    await store.writeJson(report.id, "complete.json", {
      ...answer,
      issue_number: issue?.number ?? null,
      issue_error: issue?.error ?? null,
      completed_at: new Date(completedAt).toISOString(),
      attachments,
      event_sent: false,
    });
    const sent = await sendEvent(report, event);
    if (sent) await markEventSent(report.id);
    const missing = [sent ? null : "event queued", issue?.error ? "no issue" : null].filter(Boolean);
    log(`[feedback] ${report.id} completed (${attachments.filter((a) => a.received).length}/${attachments.length} files${issue?.url ? `, ${issue.url}` : ""}${missing.length ? `; ${missing.join(", ")}` : ""})`);
    return answer;
  }

  async function complete(req, res, ip, rawId) {
    const surface = surfaceOf(req);
    limit("complete", ip);
    const report = await authorize(req, rawId);
    if (report.ingest !== surface) throw new HttpError(403, "bad_key", "key does not match the report's source");
    await readBody(req, 1024);
    let pending = completing.get(report.id);
    if (!pending) {
      pending = finish(report).finally(() => completing.delete(report.id));
      completing.set(report.id, pending);
    }
    sendJson(res, 200, await pending);
  }

  return async function handle(req, res) {
    const ip = String(req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown");
    const path = new URL(req.url, "http://feedback").pathname;
    try {
      let match;
      if (path === "/healthz") return sendJson(res, 200, { ok: true });
      if (path === "/api/feedback") {
        if (req.method !== "POST") throw new HttpError(405, "method", "POST only");
        return await create(req, res, ip);
      }
      if ((match = FILE_ROUTE.exec(path))) {
        if (req.method !== "PUT") throw new HttpError(405, "method", "PUT only");
        return await upload(req, res, ip, match[1], match[2]);
      }
      if ((match = COMPLETE_ROUTE.exec(path))) {
        if (req.method !== "POST") throw new HttpError(405, "method", "POST only");
        return await complete(req, res, ip, match[1]);
      }
      throw new HttpError(404, "not_found", "no such route");
    } catch (error) {
      const known = error instanceof HttpError;
      const backend = error instanceof BackendError ? error.backend : null;
      if (!known) log(`[feedback] ${req.method} ${path} failed (${backend ?? "internal"}): ${(backend ? error.cause : error)?.stack ?? error}`);
      if (res.headersSent) return res.destroy();
      if (!req.complete) res.setHeader("Connection", "close");
      if (known) {
        sendJson(res, error.status, { error: error.code, message: error.message });
      } else if (backend) {
        res.setHeader("Retry-After", String(RETRY_AFTER_SECONDS));
        sendJson(res, 502, { error: `upstream:${backend}`, backend, retryable: true, message: UPSTREAM_MESSAGES[backend] });
      } else {
        sendJson(res, 500, { error: "internal", retryable: true, message: "the report service hit a bug; try again" });
      }
      drain(req);
    }
  };
}

function drain(req) {
  if (!req.complete && Number(req.headers["content-length"] ?? Infinity) <= 1024 * 1024) req.resume();
}

