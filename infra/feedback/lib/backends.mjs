import { createWriteStream } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

export class UploadSizeError extends Error {
  constructor(expected, received) {
    super(`expected ${expected} bytes, got ${received}${received > expected ? "+" : ""}`);
    this.expected = expected;
    this.received = received;
  }
}

function exactSize(expected) {
  let received = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length;
      if (received > expected) return done(new UploadSizeError(expected, received));
      done(null, chunk);
    },
    flush(done) {
      done(received === expected ? null : new UploadSizeError(expected, received));
    },
  });
}

export function localStore(dir) {
  const folder = (id) => join(dir, "feedback", id);
  return {
    describe: () => `files in ${join(dir, "feedback")}`,
    async exists(id) {
      return stat(join(folder(id), "report.json")).then(() => true, () => false);
    },
    async readJson(id, name) {
      const text = await readFile(join(folder(id), name), "utf8").catch((error) => (error.code === "ENOENT" ? null : Promise.reject(error)));
      return text === null ? null : JSON.parse(text);
    },
    async writeJson(id, name, value) {
      await mkdir(folder(id), { recursive: true });
      const path = join(folder(id), name);
      await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
      await rename(`${path}.tmp`, path);
    },
    async putFile(id, name, input, bytes) {
      await mkdir(folder(id), { recursive: true });
      const path = join(folder(id), name);
      const partial = `${path}.part`;
      try {
        await pipeline(input, exactSize(bytes), createWriteStream(partial));
        await rename(partial, path);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
    },
    async fileSize(id, name) {
      return stat(join(folder(id), name)).then((s) => s.size, () => null);
    },
  };
}

const filerProblem = async (res) => (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);

export function seaweedStore(host, port = 8888) {
  const path = (id, name) => `/buckets/feedback/${id}/${encodeURIComponent(name)}`;
  const call = (method, id, name, headers = {}, body) =>
    fetch(`http://${host}:${port}${path(id, name)}`, { method, headers, body, signal: AbortSignal.timeout(15_000) });
  return {
    describe: () => `SeaweedFS ${host}:${port}/buckets/feedback`,
    async exists(id) {
      const res = await call("HEAD", id, "report.json");
      if (res.status === 404) return false;
      if (res.ok) return true;
      throw new Error(`seaweedfs HEAD ${res.status}`);
    },
    async readJson(id, name) {
      const res = await call("GET", id, name);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`seaweedfs GET ${name} ${res.status}: ${await filerProblem(res)}`);
      return res.json();
    },
    async writeJson(id, name, value) {
      const res = await call("PUT", id, name, { "Content-Type": "application/json" }, JSON.stringify(value));
      if (!res.ok) throw new Error(`seaweedfs PUT ${name} ${res.status}: ${await filerProblem(res)}`);
    },
    async putFile(id, name, input, bytes) {
      const upstream = request({
        host,
        port,
        method: "PUT",
        path: path(id, name),
        headers: { "Content-Type": "application/octet-stream", "Content-Length": bytes },
        timeout: 120_000,
      });
      const answered = new Promise((resolve, reject) => {
        upstream.on("response", (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.length < 4 && chunks.push(chunk));
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) return resolve();
            const problem = Buffer.concat(chunks).toString("utf8").replace(/\s+/g, " ").trim().slice(0, 300);
            reject(new Error(`seaweedfs PUT ${name} ${res.statusCode}: ${problem}`));
          });
        });
        upstream.on("timeout", () => upstream.destroy(new Error("seaweedfs PUT timed out")));
        upstream.on("error", reject);
      });
      try {
        await Promise.all([pipeline(input, exactSize(bytes), upstream), answered]);
      } catch (error) {
        upstream.destroy();
        answered.catch(() => {});
        await call("DELETE", id, name).catch(() => {});
        throw error;
      }
    },
    async fileSize(id, name) {
      const res = await call("HEAD", id, name);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`seaweedfs HEAD ${name} ${res.status}`);
      return Number(res.headers.get("content-length"));
    },
  };
}

export function otlpEvents(host, port = 4318) {
  return {
    describe: () => `OTLP ${host}:${port}`,
    async send(id, ingest, body) {
      const res = await fetch(`http://${host}:${port}/v1/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Ardia-Ingest": ingest },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`collector ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    },
  };
}

export function localEvents(dir) {
  return {
    describe: () => `${join(dir, "events.jsonl")}`,
    async send(id, ingest, body) {
      const record = { ingest_key: ingest, ...body };
      await mkdir(join(dir, "feedback", id), { recursive: true });
      await writeFile(join(dir, "feedback", id, "event.json"), `${JSON.stringify(record, null, 2)}\n`);
      await appendFile(join(dir, "events.jsonl"), `${JSON.stringify(record)}\n`);
    },
  };
}

export function githubIssues(token, repo, apiBase = "https://api.github.com") {
  return {
    describe: () => `GitHub issues on ${repo}`,
    async create(id, { title, body, labels }) {
      const res = await fetch(`${apiBase}/repos/${repo}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "ardia-feedback",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ title, body, labels }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`github ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const issue = await res.json();
      return { number: issue.number, url: issue.html_url };
    },
  };
}

export function localIssues(dir) {
  return {
    describe: () => `would-be issues in ${join(dir, "feedback", "<id>", "issue.md")}`,
    async create(id, { title, body, labels }) {
      const path = join(dir, "feedback", id, "issue.md");
      await mkdir(join(dir, "feedback", id), { recursive: true });
      await writeFile(path, `# ${title}\n\nLabels: ${labels.join(", ")}\n\n${body}\n`);
      return { number: null, url: pathToFileURL(path).href };
    },
  };
}
