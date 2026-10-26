import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = await mkdtemp(join(tmpdir(), "ardia-brief-provider-test-"));
const requestsPath = join(scratch, "requests.txt");
const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  appendFileSync(requestsPath, `${request.url}\n`);
  if (request.url !== "/v1/models") {
    response.writeHead(500).end();
    return;
  }
  setTimeout(() => response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ models: [{ visibility: "list", slug: "test-model" }] })), 700);
});

const run = (command, args, env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
  const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(new Error(`${command} failed: ${signal ?? code}`));
  });
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const source = await readFile(new URL("../ios/BriefsModule.swift", import.meta.url), "utf8");
  const fixture = await readFile(new URL("./brief-provider-tests.swift", import.meta.url), "utf8");
  const marker = "private struct BriefProviderError:";
  assert(source.includes(marker));
  const provider = source.slice(source.indexOf(marker)).replace('private let resource = "https://api.openai.com/v1"', 'private let resource = ProcessInfo.processInfo.environment["ARDIA_BRIEF_TEST_RESOURCE"]!');
  assert(provider.includes('private let resource = ProcessInfo.processInfo.environment["ARDIA_BRIEF_TEST_RESOURCE"]!'));
  const imports = 'import Foundation\nimport Network\nimport Security\nimport CryptoKit\nimport LocalAuthentication\nfunc ArdiaIsolatedDataDirectory() -> String? { ProcessInfo.processInfo.environment["ARDIA_BRIEF_TEST_DATA"] }\n';
  const swift = join(scratch, "ProviderTests.swift");
  const binary = join(scratch, "provider-tests");
  await writeFile(swift, imports + provider + fixture);
  await run("xcrun", ["swiftc", "-parse-as-library", "-swift-version", "5", swift, "-o", binary]);
  const reviewCases = process.env.ARDIA_BRIEF_REVIEW_CASE === "baseline" ? [] : process.env.ARDIA_BRIEF_REVIEW_CASE ? [process.env.ARDIA_BRIEF_REVIEW_CASE] : ["isolated-storage", "isolated-migration", "disconnect-account", "reauthorization-hint", "callback-terminal", "callback-prestart-cancel"];
  for (const reviewCase of reviewCases) await run(binary, [], { ARDIA_BRIEF_REVIEW_CASE: reviewCase, ARDIA_BRIEF_TEST_DATA: join(scratch, reviewCase), ARDIA_BRIEF_TEST_RESOURCE: `http://127.0.0.1:${server.address().port}/v1` });
  if (!process.env.ARDIA_BRIEF_REVIEW_CASE || process.env.ARDIA_BRIEF_REVIEW_CASE === "baseline") await run(binary, [], { ARDIA_BRIEF_TEST_DATA: join(scratch, "data"), ARDIA_BRIEF_TEST_REQUESTS: requestsPath, ARDIA_BRIEF_TEST_RESOURCE: `http://127.0.0.1:${server.address().port}/v1` });
  assert.deepEqual(requests, process.env.ARDIA_BRIEF_REVIEW_CASE && process.env.ARDIA_BRIEF_REVIEW_CASE !== "baseline" ? [] : ["/v1/models"]);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
