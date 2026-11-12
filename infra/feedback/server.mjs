#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { githubIssues, localEvents, localIssues, localStore, otlpEvents, seaweedStore } from "./lib/backends.mjs";
import { createService } from "./lib/service.mjs";

const USAGE = `ardia feedback service

usage:
  node infra/feedback/server.mjs                 production: SeaweedFS, the collector, GitHub
  node infra/feedback/server.mjs --local <dir>   local: writes reports, events and would-be issues to <dir>

options:
  --local <dir>   no ClickHouse, SeaweedFS or GitHub; everything lands in <dir>
  --port <n>      listen port (default $PORT or 4319)
  --host <addr>   listen address (default 127.0.0.1 with --local, else 0.0.0.0)
  --rate-limits   keep the per-address rate limits in local mode (off by default there)

production env:
  FEEDBACK_UPLOAD_SECRET  HMAC key for upload tokens, at least 32 characters (required)
  OBJECTS_HOST            SeaweedFS filer host, port 8888 (required)
  COLLECTOR_HOST          OpenTelemetry collector host, port 4318 (required)
  GITHUB_ISSUES_TOKEN     token that can open issues; without it no issue is opened
  GITHUB_REPO             default ardia-browser/ardia
  DASHBOARD_URL           default https://dash.ardia.dev
  PUBLIC_URL              origin used in upload_urls, default https://ardia.dev
`;

const { values } = parseArgs({
  options: {
    local: { type: "string" },
    port: { type: "string" },
    host: { type: "string" },
    "rate-limits": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const env = process.env;
const fail = (message) => {
  process.stderr.write(`feedback: ${message}\n\n${USAGE}`);
  process.exit(64);
};
const port = Number(values.port ?? env.PORT ?? 4319);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`bad port ${values.port ?? env.PORT}`);
const dashboardUrl = (env.DASHBOARD_URL || "https://dash.ardia.dev").replace(/\/+$/, "");

async function localSecret(dir) {
  if (env.FEEDBACK_UPLOAD_SECRET) return env.FEEDBACK_UPLOAD_SECRET;
  const path = join(dir, ".upload-secret");
  const saved = await readFile(path, "utf8").catch(() => "");
  if (saved.trim().length >= 32) return saved.trim();
  const secret = randomBytes(32).toString("base64url");
  await writeFile(path, `${secret}\n`, { mode: 0o600 });
  return secret;
}

let config;
if (values.local !== undefined) {
  const dir = resolve(values.local);
  await mkdir(dir, { recursive: true });
  config = {
    mode: "local",
    host: values.host ?? "127.0.0.1",
    store: localStore(dir),
    events: localEvents(dir),
    issues: localIssues(dir),
    secret: await localSecret(dir),
    publicUrl: (req) => (env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, "") : `http://${req.headers.host ?? `127.0.0.1:${port}`}`),
    rateLimits: values["rate-limits"],
  };
} else {
  const secret = env.FEEDBACK_UPLOAD_SECRET ?? "";
  if (secret.length < 32) fail("FEEDBACK_UPLOAD_SECRET must be set to at least 32 characters");
  if (!env.OBJECTS_HOST) fail("OBJECTS_HOST is required");
  if (!env.COLLECTOR_HOST) fail("COLLECTOR_HOST is required");
  const publicUrl = (env.PUBLIC_URL || "https://ardia.dev").replace(/\/+$/, "");
  config = {
    mode: "production",
    host: values.host ?? "0.0.0.0",
    store: seaweedStore(env.OBJECTS_HOST),
    events: otlpEvents(env.COLLECTOR_HOST),
    issues: env.GITHUB_ISSUES_TOKEN ? githubIssues(env.GITHUB_ISSUES_TOKEN, env.GITHUB_REPO || "ardia-browser/ardia") : null,
    secret,
    publicUrl: () => publicUrl,
    rateLimits: true,
  };
}

const handle = createService({ ...config, dashboardUrl });
const server = createServer(handle);
server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 60 * 1000;
server.keepAliveTimeout = 65 * 1000;
server.listen(port, config.host, () => {
  const { port: bound } = server.address();
  console.log(`[feedback] ${config.mode} on http://${config.host}:${bound}`);
  console.log(`[feedback] storage: ${config.store.describe()}; events: ${config.events.describe()}; issues: ${config.issues ? config.issues.describe() : "off (no GITHUB_ISSUES_TOKEN)"}`);
});
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
