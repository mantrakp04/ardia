import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const hermes = resolve(here, "../../../macos/Pods/hermes-engine/destroot/bin/hermes");
const omnibox = resolve(here, "../../../../../packages/core/src/omnibox.ts");
const typescript = createRequire(import.meta.url)("typescript");

function hermesScript(entry, driver) {
  const modules = new Map();
  const load = (file) => {
    if (modules.has(file)) return;
    const { outputText } = typescript.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
    });
    const deps = {};
    modules.set(file, { code: outputText, deps });
    for (const [, name] of outputText.matchAll(/require\("(\.[^"]+)"\)/g)) load((deps[name] = resolve(dirname(file), name)));
  };
  load(entry);
  const defs = [...modules].map(([file, { code, deps }]) => `defs[${JSON.stringify(file)}] = [function (module, exports, require) {\n${code}\n}, ${JSON.stringify(deps)}];`);
  return `var defs = {}, cache = {};
function load(file) {
  if (cache[file]) return cache[file].exports;
  var module = (cache[file] = { exports: {} });
  defs[file][0](module, module.exports, function (name) { return load(defs[file][1][name]); });
  return module.exports;
}
${defs.join("\n")}
var core = load(${JSON.stringify(entry)});
${driver}`;
}

const HYPHENATED_WORDS = [
  "my-blog-post.another-post.third-post.fourth-post.fifth-post.sixth-post.seventh-post.eighth-post:",
  "foo-bar.".repeat(8) + ":",
  "aa-aa.".repeat(15) + "-",
  "aa-aa.".repeat(15) + "..",
];

test("fixupUrl on hyphenated dotted words neither throws nor stalls in Hermes", { skip: !existsSync(hermes) && "no Hermes binary in Pods" }, () => {
  const driver = `var inputs = ${JSON.stringify(HYPHENATED_WORDS)};
inputs.forEach(function (text) { for (var i = 1; i <= text.length; i++) core.fixupUrl(text.slice(0, i)); });
print(JSON.stringify(inputs.map(function (text) { return core.fixupUrl(text); })));`;
  const dir = mkdtempSync(join(tmpdir(), "ardia-fixup-hermes-"));
  try {
    const file = join(dir, "fixup.js");
    writeFileSync(file, hermesScript(omnibox, driver));
    const run = spawnSync(hermes, [file], { encoding: "utf8", timeout: 30_000 });
    assert.equal(run.status, 0, run.stderr || `hermes exited with ${run.status} (${run.signal ?? "no signal"})`);
    assert.deepEqual(JSON.parse(run.stdout), HYPHENATED_WORDS.map(() => null));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
