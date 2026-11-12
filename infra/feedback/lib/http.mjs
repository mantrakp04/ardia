export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}

export async function readBody(req, limit) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "too_large", `body over ${limit} bytes`);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "too_large", `body over ${limit} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit) {
  const type = String(req.headers["content-type"] ?? "");
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, "json_only", "Content-Type must be application/json");
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_json", "body is not valid JSON");
  }
}

export function rateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map();
  let lastSweep = now();
  return (key) => {
    const at = now();
    if (at - lastSweep > windowMs) {
      for (const [k, times] of hits) if (times[times.length - 1] <= at - windowMs) hits.delete(k);
      lastSweep = at;
    }
    const times = (hits.get(key) ?? []).filter((t) => t > at - windowMs);
    if (times.length >= limit) {
      hits.set(key, times);
      return false;
    }
    times.push(at);
    hits.set(key, times);
    return true;
  };
}
