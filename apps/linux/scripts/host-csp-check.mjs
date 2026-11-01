import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `Usage: node scripts/host-csp-check.mjs [chromium-binary]

Builds the CSP fixture, loads it in a headless Chromium with a scratch profile
and prints the fixture result as JSON. Exits 0 only when every check passed.
The browser defaults to $ARDIA_CSP_BROWSER, then /usr/bin/chromium.`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const browser = process.argv[2] ?? process.env.ARDIA_CSP_BROWSER ?? "/usr/bin/chromium";
const root = fileURLToPath(new URL("..", import.meta.url));
const profile = await mkdtemp(join(tmpdir(), "ardia-csp-check-"));
const children = [];
const within = async (ms, what, promise) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms); })]);
  } finally {
    clearTimeout(timer);
  }
};
const exited = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resolve) => child.once("exit", resolve)));
const stop = async (code) => {
  for (const child of children) child.kill("SIGTERM");
  await within(10000, "Stopping the fixture and Chromium", Promise.all(children.map(exited))).catch(() => {
    for (const child of children) child.kill("SIGKILL");
  });
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
};
const matchOutput = (child, stream, pattern, what) => new Promise((resolve, reject) => {
  let buffer = "";
  child.once("error", (error) => reject(new Error(`${what} failed: ${error.message}`)));
  child.once("exit", (code, signal) => reject(new Error(`${what} exited (${signal ?? code}) before it was ready`)));
  stream.on("data", (data) => {
    buffer += String(data);
    const match = pattern.exec(buffer);
    if (match) resolve(match[0]);
  });
});
const CDP_STEP_MS = 5000;

try {
  const fixture = spawn(process.execPath, [join(root, "scripts/host-csp-fixture.mjs")], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
  children.push(fixture);
  const url = await within(180000, "The fixture build", matchOutput(fixture, fixture.stdout, /http:\/\/127\.0\.0\.1:\d+\//, "The fixture build"));
  const chrome = spawn(browser, ["--headless=new", "--no-first-run", "--disable-gpu", "--disable-extensions", "--disable-component-extensions-with-background-pages", `--user-data-dir=${profile}`, "--remote-debugging-port=0", url], { stdio: ["ignore", "ignore", "pipe"] });
  children.push(chrome);
  const devtools = new URL(await within(30000, "Chromium startup", matchOutput(chrome, chrome.stderr, /ws:\/\/\S+/, `Chromium (${browser})`)));
  const evaluate = async (expression) => {
    const response = await fetch(`http://127.0.0.1:${devtools.port}/json`, { signal: AbortSignal.timeout(CDP_STEP_MS) });
    const targets = await within(CDP_STEP_MS, "The DevTools target list", response.json());
    const page = targets.find((target) => target.type === "page" && target.url.startsWith(url));
    if (!page) return null;
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    try {
      await within(CDP_STEP_MS, "The DevTools connection", new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", () => reject(new Error("The DevTools connection failed")), { once: true });
      }));
      const reply = await within(CDP_STEP_MS, "Runtime.evaluate", new Promise((resolve, reject) => {
        socket.addEventListener("message", (event) => resolve(JSON.parse(event.data)), { once: true });
        socket.addEventListener("close", () => reject(new Error("The DevTools connection closed")), { once: true });
        socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
      }));
      return reply.result?.result?.value ?? null;
    } finally {
      socket.close();
    }
  };
  let result = null;
  const deadline = Date.now() + 45000;
  while (!result && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const value = await evaluate("JSON.stringify(window.__ardiaCspResult ?? null)").catch(() => null);
    if (value && value !== "null") result = JSON.parse(value);
  }
  if (!result) result = { passed: false, errors: ["The fixture produced no result"], page: await evaluate("document.getElementById('root')?.textContent?.slice(0, 300) ?? null").catch(() => null) };
  console.log(JSON.stringify(result, null, 1));
  await stop(result.passed ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await stop(1);
}
