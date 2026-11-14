export const KINDS = ["bug", "slow", "idea", "other"];
export const SOURCES = ["app", "cli"];
export const WATCH_DAYS = [0, 14];
export const MIB = 1024 * 1024;
export const MAX_JSON_BYTES = 128 * 1024;
export const MAX_DIAGNOSTICS_BYTES = 64 * 1024;
export const MAX_ATTACHMENTS = 16;
export const LIMITS = { title: 67, description: 4000, contact: 200, page_address: 2048 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_FIELD = /^[\x20-\x7e]{1,64}$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9.+-]{0,49}\/[a-z0-9][a-z0-9.+-]{0,49}$/i;
const CONTROL_EXCEPT_NEWLINE_TAB = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const SHORT_FIELDS = ["app_version", "app_build", "channel", "os_version", "arch", "cli_version"];
const FIELDS = new Set([
  "kind", "title", "description", "source", "install_id", "session_id", ...SHORT_FIELDS,
  "contact", "page_address", "watch_days", "diagnostics", "attachments",
]);
const ATTACHMENT_FIELDS = new Set(["name", "bytes", "type"]);

export function attachmentRule(name) {
  if (typeof name !== "string") return null;
  if (name === "recording.mp4") return { kind: "recording", cap: 100 * MIB };
  if (name === "trace.json.gz") return { kind: "trace", cap: 50 * MIB };
  if (name === "local-events.jsonl.gz") return { kind: "local_events", cap: 10 * MIB };
  if (/^crash-[1-9][0-9]?\.ips$/.test(name)) return { kind: "crash", cap: 10 * MIB };
  if (/^attachment-[1-9][0-9]?\.[a-z0-9]{1,8}$/.test(name)) return { kind: "attachment", cap: 10 * MIB };
  return null;
}

export const codePoints = (text) => [...text].length;

class Invalid extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.field = field;
  }
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const absent = (value) => value === undefined || value === null;

function text(body, field, { max, required, multiline }) {
  const raw = body[field];
  if (absent(raw) || raw === "") {
    if (required) throw new Invalid(field, "required");
    return null;
  }
  if (typeof raw !== "string") throw new Invalid(field, "must be a string");
  const value = (multiline ? raw.replace(/\r\n?/g, "\n") : raw).trim();
  if (value === "") {
    if (required) throw new Invalid(field, "required");
    return null;
  }
  if ((multiline ? CONTROL_EXCEPT_NEWLINE_TAB : CONTROL).test(value)) throw new Invalid(field, "contains control characters");
  if (codePoints(value) > max) throw new Invalid(field, `at most ${max} characters`);
  return value;
}

function oneOf(body, field, allowed, fallback) {
  const value = body[field];
  if (absent(value) && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) throw new Invalid(field, `must be one of ${allowed.join(", ")}`);
  return value;
}

function uuid(body, field, required) {
  const value = body[field];
  if (absent(value)) {
    if (required) throw new Invalid(field, "required");
    return null;
  }
  if (typeof value !== "string" || !UUID.test(value)) throw new Invalid(field, "must be a UUID");
  return value.toLowerCase();
}

function shortField(body, field, required) {
  const value = body[field];
  if (absent(value) || value === "") {
    if (required) throw new Invalid(field, "required");
    return null;
  }
  if (typeof value !== "string" || !SHORT_FIELD.test(value)) throw new Invalid(field, "must be 1-64 printable ASCII characters");
  return value;
}

function diagnostics(body) {
  const value = body.diagnostics;
  if (absent(value)) return null;
  if (!isPlainObject(value)) throw new Invalid("diagnostics", "must be an object");
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_DIAGNOSTICS_BYTES) throw new Invalid("diagnostics", "at most 64 KB of JSON");
  return value;
}

function attachments(body) {
  const list = body.attachments;
  if (absent(list)) return [];
  if (!Array.isArray(list)) throw new Invalid("attachments", "must be a list");
  if (list.length > MAX_ATTACHMENTS) throw new Invalid("attachments", `at most ${MAX_ATTACHMENTS}`);
  const seen = new Set();
  return list.map((item, i) => {
    const field = `attachments[${i}]`;
    if (!isPlainObject(item)) throw new Invalid(field, "must be { name, bytes, type }");
    for (const key of Object.keys(item)) if (!ATTACHMENT_FIELDS.has(key)) throw new Invalid(`${field}.${key}`, "unknown field");
    const rule = attachmentRule(item.name);
    if (!rule) throw new Invalid(`${field}.name`, "must be recording.mp4, trace.json.gz, local-events.jsonl.gz, crash-<n>.ips or attachment-<n>.<ext>");
    if (seen.has(item.name)) throw new Invalid(`${field}.name`, "listed twice");
    seen.add(item.name);
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 1) throw new Invalid(`${field}.bytes`, "must be a positive whole number");
    if (item.bytes > rule.cap) throw new Invalid(`${field}.bytes`, `${item.name} is capped at ${rule.cap / MIB} MB`);
    if (typeof item.type !== "string" || !MIME_TYPE.test(item.type)) throw new Invalid(`${field}.type`, "must be a media type like video/mp4");
    return { name: item.name, bytes: item.bytes, type: item.type.toLowerCase() };
  });
}

export function validateReport(body) {
  try {
    if (!isPlainObject(body)) throw new Invalid("body", "must be a JSON object");
    for (const key of Object.keys(body)) if (!FIELDS.has(key)) throw new Invalid(key, "unknown field");
    const source = oneOf(body, "source", SOURCES);
    const report = {
      kind: oneOf(body, "kind", KINDS),
      title: text(body, "title", { max: LIMITS.title, required: true }),
      description: text(body, "description", { max: LIMITS.description, required: true, multiline: true }),
      source,
      install_id: uuid(body, "install_id", true),
      session_id: uuid(body, "session_id", false),
      app_version: shortField(body, "app_version", source === "app"),
      app_build: shortField(body, "app_build", false),
      channel: shortField(body, "channel", false),
      os_version: shortField(body, "os_version", false),
      arch: shortField(body, "arch", false),
      cli_version: shortField(body, "cli_version", source === "cli"),
      contact: text(body, "contact", { max: LIMITS.contact }),
      page_address: text(body, "page_address", { max: LIMITS.page_address }),
      watch_days: oneOf(body, "watch_days", WATCH_DAYS, 0),
      diagnostics: diagnostics(body),
      attachments: attachments(body),
    };
    return { report };
  } catch (error) {
    if (error instanceof Invalid) return { error: { field: error.field, message: error.message } };
    throw error;
  }
}
