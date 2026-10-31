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
const stop = async (code) => {
  for (const child of children) child.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
};
const within = (ms, what, promise) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms))]);
const matchOutput = (stream, pattern) => new Promise((resolve) => {
  let buffer = "";
  stream.on("data", (data) => {
    buffer += String(data);
    const match = pattern.exec(buffer);
    if (match) resolve(match[0]);
  });
});

try {
  const fixture = spawn(process.execPath, [join(root, "scripts/host-csp-fixture.mjs")], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
  children.push(fixture);
  const url = await within(180000, "The fixture build", matchOutput(fixture.stdout, /http:\/\/127\.0\.0\.1:\d+\//));
  const chrome = spawn(browser, ["--headless=new", "--no-first-run", "--disable-gpu", "--disable-extensions", "--disable-component-extensions-with-background-pages", `--user-data-dir=${profile}`, "--remote-debugging-port=0", url], { stdio: ["ignore", "ignore", "pipe"] });
  children.push(chrome);
  const devtools = new URL(await within(30000, "Chromium startup", matchOutput(chrome.stderr, /ws:\/\/\S+/)));
  const evaluate = async (expression) => {
    const targets = await (await fetch(`http://127.0.0.1:${devtools.port}/json`)).json();
    const page = targets.find((target) => target.type === "page" && target.url.startsWith(url));
    if (!page) return null;
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
    const reply = await new Promise((resolve) => {
      socket.addEventListener("message", (event) => resolve(JSON.parse(event.data)), { once: true });
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
    socket.close();
    return reply.result?.result?.value ?? null;
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
