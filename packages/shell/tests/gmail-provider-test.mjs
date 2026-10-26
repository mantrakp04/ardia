import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = await mkdtemp(join(tmpdir(), "ardia-gmail-provider-test-"));
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "inherit" });
  const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(new Error(`${command} failed: ${signal ?? code}`));
  });
});

try {
  const source = await readFile(new URL("../ios/GmailModule.swift", import.meta.url), "utf8");
  const fixture = await readFile(new URL("./gmail-provider-tests.swift", import.meta.url), "utf8");
  const briefSource = await readFile(new URL("../ios/BriefsModule.swift", import.meta.url), "utf8");
  const callbackStart = briefSource.indexOf("struct OAuthLoopbackError:");
  const callbackEnd = briefSource.indexOf("private struct BriefSignIn {");
  assert(callbackStart >= 0 && callbackEnd > callbackStart);
  const callback = briefSource.slice(callbackStart, callbackEnd);
  const marker = "private struct GmailError:";
  assert(source.includes(marker));
  let provider = source.slice(source.indexOf(marker));
  const secretsStart = provider.indexOf("private enum GmailSecrets {");
  const secretsEnd = provider.indexOf("private final class GmailRedirectDelegate:");
  assert(secretsStart >= 0 && secretsEnd > secretsStart);
  provider = provider.slice(0, secretsStart) + 'enum GmailSecrets { static var value = GmailStore(); static func load() throws -> GmailStore { value }; static func save(_ store: GmailStore) throws { value = store } }\n' + provider.slice(secretsEnd);
  const refreshStart = provider.indexOf("  private func refresh(");
  const refreshEnd = provider.indexOf("  private func credentialOf(");
  assert(refreshStart >= 0 && refreshEnd > refreshStart);
  provider = provider.slice(0, refreshStart) + '  private func refresh(_ credential: GmailCredential, generation: Int) async throws -> GmailCredential { await GmailRefreshFixture.shared.next(credential) }\n' + provider.slice(refreshEnd);
  provider = provider.replaceAll("private ", "");
  const imports = 'import Foundation\nimport AppKit\nimport Network\nimport Security\nimport CryptoKit\nimport LocalAuthentication\nfunc ArdiaIsolatedDataDirectory() -> String? { "/tmp/ardia-gmail-test-no-credentials" }\n';
  const swift = join(scratch, "GmailTests.swift");
  const binary = join(scratch, "gmail-tests");
  await writeFile(swift, imports + callback + provider + fixture);
  await run("xcrun", ["swiftc", "-parse-as-library", "-swift-version", "5", swift, "-o", binary]);
  await run(binary, []);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
