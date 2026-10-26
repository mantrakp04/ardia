import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const LAYER_FOLDERS = [
  ["components/ui/", "ui"],
  ["components/", "components"],
  ["state/", "state"],
  ["platform/", "platform"],
  ["lib/", "lib"],
];
const ENTRY_FILES = ["App", "main"];
const MAY_IMPORT = {
  app: ["app", "components", "ui", "state", "platform", "lib"],
  components: ["components", "ui", "state", "lib"],
  ui: ["ui", "lib"],
  state: ["state", "platform", "lib"],
  platform: ["platform", "lib"],
  lib: ["lib"],
};
const MAY_CALL_NATIVE = ["platform", "ui"];
const HANDS_PLATFORM_TO_SCRIPTS = new Set(["components/dev/devHarness.ts"]);

const RULES = ["layout", "imports", "native-calls", "tokens", "get-state", "set-state", "store-reads", "store-shape", "size", "env", "naming", "comments", "file-names"];
const SIZE_CAP = { js: 400, native: 600 };
const SCOPES = ["apps/browser/src", "packages", "engine/ardiacore/src", "engine/chromium/src"];
const GENERATED = new Set(["packages/core/src/bangList.ts"]);
const ONE_INJECTED_SCRIPT = new Set(["packages/ardiacore/ios/page_script.js"]);
const FROZEN_SPECS = new Set(["packages/core/src/suggest.reference.ts"]);
const LAUNCH_CONFIG = [/^packages\/ardiacore\/ios\/ArdiaLaunchConfig\.\w+$/, /^apps\/browser\/src\/platform\/launchConfig\.ts$/];
const MIGRATION_FILE = /(?:^|\/)(?:LegacyMigration\.swift|legacy\.ts|\w*[Mm]igrations?\.(?:ts|swift|mm|m))$/;
const TOKEN_FILE = /(?:^|\/)(?:tokens|motion)\.ts$/;
const ENGINE_ENV_READS = {
  "engine/ardiacore/src/ardia/core/ac_main_delegate.cc": [
    "std::string EnvironmentThatOpensTheProfile(base::Environment& env) {",
    "std::unique_ptr<base::Environment> env = base::Environment::Create();",
  ],
  "engine/chromium/src/chrome/browser/ardia/ac_scripts_policy.cc": ['if (const char* home = getenv("HOME")) {'],
};

const APP_SRC = "apps/browser/src/";
const BASELINE_PATH = `${APP_SRC}conventions-baseline.json`;
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const SOURCE_FILE = /\.(?:tsx?|mjs|js|swift|h|m|mm|cc|mojom)$/;
const SCOPE_FILE = /^(?:apps\/browser\/src\/|packages\/[^/]+\/(?:src|ios)\/|engine\/(?:ardiacore|chromium)\/src\/)/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$|(?:^|\/)(?:test-native|fixtures|tests|Tests)\/|(?:^|\/)test-(?:loader|hooks)\.mjs$/;

const TOOL_DIRECTIVE =
  /^(?:\/\/+|\/\*+)\s*(?:@ts-(?:expect-error|ignore|nocheck)|eslint-(?:disable|enable)|swiftlint:|swift-format-ignore|prettier-ignore|clang-format (?:on|off)|NOLINT|nogncheck|IWYU pragma|[#@]__PURE__|# sourceURL=|# sourceMappingURL=)/;
const LICENSE_HEADER = /copyright|licen[cs]e|spdx/i;
const REGEX_AFTER_WORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);

function scanSource(src, lang, embedded = false) {
  const n = src.length;
  const comments = [];
  const strings = [];
  let i = 0;
  let regexOk = true;

  const lineComment = () => {
    const start = i;
    while (i < n && src[i] !== "\n") i++;
    comments.push([start, i]);
  };
  const blockComment = () => {
    const start = i;
    if (lang === "swift") {
      let depth = 0;
      while (i < n) {
        if (src.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (src.startsWith("*/", i)) {
          depth--;
          i += 2;
          if (!depth) break;
        } else i++;
      }
    } else {
      const end = src.indexOf("*/", i + 2);
      if (end < 0 && embedded) return false;
      i = end < 0 ? n : end + 2;
    }
    comments.push([start, i]);
    return true;
  };
  const quoted = (quote) => {
    const start = ++i;
    while (i < n && src[i] !== quote && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
    strings.push({ start, end: Math.min(i, n), embedded: false, holes: [] });
    i++;
  };
  const rawCString = () => {
    const open = src.indexOf("(", i);
    const delimiter = src.slice(i + 1, open);
    const close = `)${delimiter}"`;
    const start = open + 1;
    const end = src.indexOf(close, start);
    const stop = end < 0 ? n : end;
    strings.push({ start, end: stop, embedded: true, holes: [] });
    i = stop + close.length;
  };
  const template = () => {
    const start = ++i;
    const holes = [];
    while (i < n && src[i] !== "`") {
      if (src[i] === "\\") {
        i += 2;
      } else if (src[i] === "$" && src[i + 1] === "{") {
        const hole = i;
        i += 2;
        code("}");
        i++;
        holes.push([hole, i]);
      } else i++;
    }
    strings.push({ start, end: Math.min(i, n), embedded: true, holes });
    i++;
  };
  const swiftString = () => {
    let hashes = 0;
    while (src[i] === "#") {
      hashes++;
      i++;
    }
    const multiline = src.startsWith('"""', i);
    i += multiline ? 3 : 1;
    const start = i;
    const close = (multiline ? '"""' : '"') + "#".repeat(hashes);
    const escape = "\\" + "#".repeat(hashes);
    const holes = [];
    while (i < n) {
      if (src.startsWith(escape, i)) {
        const after = i + escape.length;
        if (src[after] === "(") {
          const hole = i;
          i = after + 1;
          code(")");
          i++;
          holes.push([hole, i]);
        } else i = after + 1;
        continue;
      }
      if (src.startsWith(close, i) || (!multiline && src[i] === "\n")) break;
      i++;
    }
    strings.push({ start, end: Math.min(i, n), embedded: multiline, holes });
    i += src.startsWith(close, i) ? close.length : 1;
  };
  const regex = () => {
    i++;
    let inClass = false;
    while (i < n && src[i] !== "\n") {
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      i++;
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
    }
    while (i < n && /[a-z]/.test(src[i])) i++;
  };
  const code = (closer) => {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      const next = src[i + 1];
      if (c === "/" && next === "/" && (embedded ? /^$|[\s;{}(),]/.test(src[i - 1] ?? "") : src[i - 1] !== ":")) {
        lineComment();
        continue;
      }
      if (c === "/" && next === "*" && blockComment()) continue;
      if (lang === "swift") {
        if (c === '"' || (c === "#" && /^#+"/.test(src.slice(i, i + 8)))) {
          swiftString();
          continue;
        }
      } else if (c === '"' || c === "'") {
        if (lang === "c" && c === '"' && /(?:^|[^\w])(?:u8|u|U|L)?R$/.test(src.slice(Math.max(0, i - 4), i))) rawCString();
        else quoted(c);
        regexOk = false;
        continue;
      } else if (lang === "js" && c === "`") {
        template();
        regexOk = false;
        continue;
      } else if (lang === "js" && c === "/") {
        if (regexOk && !closesJsxTag(src, i)) {
          regex();
          regexOk = false;
        } else {
          i++;
          regexOk = true;
        }
        continue;
      }
      if (/[\w$]/.test(c)) {
        const start = i;
        while (i < n && /[\w$]/.test(src[i])) i++;
        regexOk = REGEX_AFTER_WORDS.has(src.slice(start, i));
        continue;
      }
      if (closer && depth === 0 && c === closer) return;
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      if (!/\s/.test(c)) regexOk = !(c === ")" || c === "]" || c === "}" || (c === ">" && src[i - 1] !== "="));
      i++;
    }
  };

  code(null);
  const codeAndStrings = blank(src, comments);
  const firstCode = codeAndStrings.search(/\S/);
  const header = comments.filter(([, end]) => firstCode < 0 || end <= firstCode);
  const licensed = header.some(([start, end]) => LICENSE_HEADER.test(src.slice(start, end)));
  const stray = comments.filter(
    (range) => !(licensed && header.includes(range)) && !TOOL_DIRECTIVE.test(src.slice(range[0], range[1])),
  );
  for (const s of strings) {
    if (!s.embedded) continue;
    const text = withoutHoles(src, s).replace(/\\([\s\S])/g, (_, ch) => (ch === "\\" ? "  " : ` ${ch}`));
    for (const [start, end] of scanSource(text, "js", true).stray) stray.push([s.start + start, s.start + end]);
  }
  return { comments, strings, stray, codeAndStrings };
}

function closesJsxTag(src, slash) {
  let before = slash - 1;
  while (before >= 0 && /\s/.test(src[before])) before--;
  return src[before] === "<";
}

function withoutHoles(src, { start, end, holes }) {
  let text = "";
  let at = start;
  for (const [holeStart, holeEnd] of holes) {
    text += src.slice(at, holeStart) + src.slice(holeStart, holeEnd).replace(/[^\n]/g, "0");
    at = holeEnd;
  }
  return text + src.slice(at, end);
}

const HEX_STRING = /^(["'`])([0-9a-f]{3,8})\1$/i;
const HEX_BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*(["'`])([0-9a-f]{3,8})\2/gi;

function hexBindings(code) {
  return new Map([...code.matchAll(HEX_BINDING)].map((match) => [match[1], match[3]]));
}

function withHexHoles(src, { start, end, holes }, bindings) {
  let text = "";
  let at = start;
  for (const [holeStart, holeEnd] of holes) {
    const inner = src.slice(holeStart + 2, holeEnd - 1).trim();
    const hex = inner.match(HEX_STRING)?.[2] ?? bindings.get(inner);
    text += src.slice(at, holeStart) + (hex ?? src.slice(holeStart, holeEnd).replace(/[^\n]/g, "_"));
    at = holeEnd;
  }
  return text + src.slice(at, end);
}

function blank(src, ranges) {
  const sorted = ranges.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [start, end] of sorted) {
    if (end <= at) continue;
    const from = Math.max(start, at);
    out += src.slice(at, from) + src.slice(from, end).replace(/[^\n]/g, " ");
    at = end;
  }
  return out + src.slice(at);
}

function stringContentRanges({ start, end, holes }) {
  const ranges = [];
  let at = start;
  for (const [holeStart, holeEnd] of holes) {
    ranges.push([at, holeStart]);
    at = holeEnd;
  }
  ranges.push([at, end]);
  return ranges;
}

function languageOf(path) {
  if (/\.(?:tsx?|mjs|js)$/.test(path)) return "js";
  if (path.endsWith(".swift")) return "swift";
  return "c";
}

function layerOf(rel) {
  for (const [prefix, layer] of LAYER_FOLDERS) if (rel.startsWith(prefix) || rel === prefix.slice(0, -1)) return layer;
  if (ENTRY_FILES.includes(rel.replace(/\.(?:tsx?|mjs|js)$/, ""))) return "app";
  return null;
}

const count = (text, pattern) => (text.match(pattern) || []).length;

const COLOR_LITERAL = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\s*\(/gi;
const MOTION_LITERAL = /\bEasing\s*\.\s*\w|\bduration\s*:\s*-?\.?\d|\bAnimated\s*\.\s*delay\s*\(\s*\d/g;
const ENV_READ =
  /\b(?:secure_)?getenv\s*\(|processInfo(?:\]\s*|\s*\.\s*)environment\b|ProcessInfo\s*\(\s*\)\s*\.\s*environment\b|\bprocess\s*\.\s*env\b|\bbase::Environment\b/g;
const CEF_NAME = /(?<![A-Za-z])(?:[Cc]ef|CEF)(?![a-z])|(?<=[a-z0-9_])(?:Cef|CEF)(?![a-z])/g;
const LEGACY_BRAND = /netnyahoo/gi;
const LEGACY_PREFIX = /\bNN[A-Z][a-z]\w*/g;
const APP_SIDE_OBJC_FILE = /^(?:AC[A-Z]|ArdiaCore[A-Z])\w*\.(?:h|m|mm|swift)$/;
const APP_SIDE_OBJC_CLASS =
  /@(?:interface|implementation|protocol)\s+(?:AC[A-Z]|ArdiaCore[A-Z])\w*\b(?!\s*[(;])|(?<!@)\b(?:class|struct|enum|protocol|actor|typealias)\s+(?:AC[A-Z]|ArdiaCore[A-Z])\w*|@objc\(\s*(?:AC[A-Z]|ArdiaCore[A-Z])\w*\s*\)/g;
const IMPORT_SPEC =
  /\b(?:import|export)\b[^;"'`]*?\bfrom\s*(["'])([^"'\n]+)\1|\bimport\s*(?:\(\s*)?(["'])([^"'\n]+)\3|\brequire\s*\(\s*(["'])([^"'\n]+)\5/g;
const NATIVE_PACKAGE = /^(?:@ardia\/(?:ardiacore|shell|shaders|import|sync)(?:\/.*)?|expo-modules-core)$/;
const NATIVE_GLOBAL = /\bNativeModules\b(?!\s*[,}])|\brequireNative(?:Module|Component|ViewManager)\s*\(/g;
const COMPONENT_FILE = /^[A-Z][A-Za-z0-9]*(?:\.(?:web|native|macos|ios))?\.tsx$/;
const MODULE_FILE = /^[a-z][A-Za-z0-9]*(?:\.(?:web|native|macos|ios))?\.(?:ts|mjs)$/;
const TEST_NAME = /^[A-Za-z][A-Za-z0-9]*\.test\.mjs$/;

function unshapedStores(code) {
  let found = 0;
  for (const match of code.matchAll(/(?<![.\w$])create\s*(<|\()/g)) {
    let at = match.index + match[0].length;
    if (match[1] === "<") {
      for (let depth = 1; at < code.length && depth; at++) depth += code[at] === "<" ? 1 : code[at] === ">" ? -1 : 0;
      if (!code.startsWith("()(", at)) found++;
      else if (/^\(\)\(\s*\(\s*set\b/.test(code.slice(at, at + 40))) found++;
    } else found++;
  }
  return found;
}

function envReads(path, src, code) {
  const exempt = ENGINE_ENV_READS[path] ?? [];
  let found = 0;
  for (const match of code.matchAll(ENV_READ)) {
    const lineStart = src.lastIndexOf("\n", match.index) + 1;
    const lineEnd = src.indexOf("\n", match.index);
    if (!exempt.includes(src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim())) found++;
  }
  return found;
}

function checkFile(path, src, add) {
  const lang = languageOf(path);
  const isTest = TEST_FILE.test(path);
  const isDeclaration = path.endsWith(".d.ts");
  const inApp = path.startsWith(APP_SRC);
  const rel = inApp ? path.slice(APP_SRC.length) : path;
  const base = posix.basename(path);
  const { strings, stray, codeAndStrings } = scanSource(src, lang);
  const code = blank(codeAndStrings, strings.flatMap(stringContentRanges));
  add("comments", path, stray.length);

  if (isTest || isDeclaration) {
    if (inApp && isTest && base.endsWith(".test.mjs") && !TEST_NAME.test(base)) add("file-names", path, 1);
    return;
  }

  const lines = src.length ? src.split("\n").length - (src.endsWith("\n") ? 1 : 0) : 0;
  const isJs = /\.tsx?$/.test(path) && (inApp || /^packages\/[^/]+\/src\//.test(path)) && !FROZEN_SPECS.has(path);
  const isNative = /\.(?:swift|h|m|mm|cc|mojom|js)$/.test(path) && !ONE_INJECTED_SCRIPT.has(path);
  if ((isJs && lines > SIZE_CAP.js) || (isNative && lines > SIZE_CAP.native)) add("size", path, 1);

  if (!LAUNCH_CONFIG.some((allowed) => allowed.test(path))) add("env", path, envReads(path, src, code));

  let naming = count(codeAndStrings, CEF_NAME);
  if (!MIGRATION_FILE.test(path)) naming += count(codeAndStrings, LEGACY_BRAND) + count(code, LEGACY_PREFIX);
  if (/^packages\/[^/]+\/ios\//.test(path)) naming += (APP_SIDE_OBJC_FILE.test(base) ? 1 : 0) + count(code, APP_SIDE_OBJC_CLASS);
  add("naming", path, naming);

  if (!inApp || !/\.(?:tsx?|mjs)$/.test(path)) return;

  if (!(COMPONENT_FILE.test(base) || MODULE_FILE.test(base) || rel === "main.tsx")) add("file-names", path, 1);

  if (!TOKEN_FILE.test(path)) {
    const bindings = hexBindings(codeAndStrings);
    const colors = strings.reduce((sum, s) => sum + count(withHexHoles(src, s, bindings), COLOR_LITERAL), 0);
    add("tokens", path, colors + count(code, MOTION_LITERAL));
  }

  if (rel.startsWith("components/")) {
    add("get-state", path, count(code, /\bgetState\s*\(/g));
    add("set-state", path, count(code, /\.setState\s*\(/g));
    add("store-reads", path, count(code, /\buseBrowser\s*\(/g));
  }
  if (/\bimport\s*\{[^}]*\bcreate\b[^}]*\}\s*from\s*["']zustand["']/.test(codeAndStrings)) add("store-shape", path, unshapedStores(code));

  const layer = layerOf(rel);
  let nativeCalls = count(code, NATIVE_GLOBAL);
  let badImports = 0;
  for (const match of codeAndStrings.matchAll(IMPORT_SPEC)) {
    const spec = match[2] ?? match[4] ?? match[6];
    if (NATIVE_PACKAGE.test(spec)) {
      nativeCalls++;
      continue;
    }
    if (!layer || !spec.startsWith(".")) continue;
    const target = posix.normalize(posix.join(posix.dirname(rel), spec));
    if (target.startsWith("..")) continue;
    const targetLayer = layerOf(target);
    const handsPlatformToScripts = targetLayer === "platform" && HANDS_PLATFORM_TO_SCRIPTS.has(rel);
    if (!targetLayer || !(MAY_IMPORT[layer].includes(targetLayer) || handsPlatformToScripts)) badImports++;
  }
  if (!MAY_CALL_NATIVE.includes(layer)) add("native-calls", path, nativeCalls);
  if (!layer) add("layout", path, 1);
  else add("imports", path, badImports);
}

function git(args, input) {
  const result = spawnSync("git", args, { cwd: ROOT, input, maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

const inScope = (path) => SCOPE_FILE.test(path) && SOURCE_FILE.test(path) && !GENERATED.has(path) && path !== posix.join(APP_SRC, "conventions.test.mjs");

function workingTreeFiles() {
  const paths = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...SCOPES]).toString().split("\0");
  return [...new Set(paths)]
    .filter((path) => inScope(path) && existsSync(ROOT + path))
    .map((path) => [path, readFileSync(ROOT + path, "utf8")]);
}

function committedFiles(fromHead) {
  const listing = fromHead ? ["ls-tree", "-r", "-z", "HEAD", "--", ...SCOPES] : ["ls-files", "-s", "-z", "--", ...SCOPES];
  const entries = git(listing)
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      return [path, meta.split(" ")[fromHead ? 2 : 1]];
    })
    .filter(([path]) => inScope(path));
  const batch = git(["cat-file", "--batch"], entries.map(([, sha]) => sha).join("\n") + "\n");
  const files = [];
  let at = 0;
  for (const [path] of entries) {
    const headerEnd = batch.indexOf(10, at);
    const size = Number(batch.toString("utf8", at, headerEnd).split(" ")[2]);
    files.push([path, batch.toString("utf8", headerEnd + 1, headerEnd + 1 + size)]);
    at = headerEnd + 1 + size + 1;
  }
  return files;
}

function findViolations(files) {
  const found = Object.fromEntries(RULES.map((rule) => [rule, {}]));
  const add = (rule, path, n) => {
    if (n > 0) found[rule][path] = (found[rule][path] ?? 0) + n;
  };
  for (const [path, src] of files) checkFile(path, src, add);
  return found;
}

const sorted = (found) =>
  Object.fromEntries(RULES.map((rule) => [rule, Object.fromEntries(Object.entries(found[rule] ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)))]));
const total = (entries = {}) => Object.values(entries).reduce((sum, n) => sum + n, 0);

function compare(baseline, found) {
  const problems = [];
  for (const rule of RULES) {
    const lines = [];
    const paths = new Set([...Object.keys(baseline[rule] ?? {}), ...Object.keys(found[rule])]);
    for (const path of [...paths].sort()) {
      const was = baseline[rule]?.[path] ?? 0;
      const now = found[rule][path] ?? 0;
      if (now > was) lines.push(`  new    ${path}: ${now}${was ? ` (baseline ${was})` : ""}`);
      else if (now < was) lines.push(`  fixed  ${path}: ${now} (baseline ${was}), lower or remove its baseline entry`);
    }
    if (lines.length) problems.push(`${rule} (${lines.length})`, ...lines);
  }
  return problems;
}

function scoreboard(found) {
  return RULES.map((rule) => `${rule} ${Object.keys(found[rule]).length} files / ${total(found[rule])}`).join(", ");
}

function report(found) {
  for (const rule of RULES) {
    console.log(`${rule}: ${Object.keys(found[rule]).length} files, ${total(found[rule])} violations`);
    for (const [path, n] of Object.entries(found[rule])) console.log(`  ${path}: ${n}`);
  }
}

function writeBaseline(fromHead, force) {
  const found = sorted(findViolations(committedFiles(fromHead)));
  let previous = null;
  try {
    previous = JSON.parse(git(["show", `HEAD:${BASELINE_PATH}`]).toString());
  } catch {}
  if (previous) {
    const grown = RULES.filter((rule) => total(found[rule]) > total(previous[rule]));
    const movedOutOfOldLayout = total(found.layout) < total(previous.layout);
    const refused = grown.filter((rule) => !(rule === "imports" && movedOutOfOldLayout));
    for (const rule of RULES) {
      const added = Object.keys(found[rule]).filter((path) => !(path in (previous[rule] ?? {})));
      console.log(`${rule}: ${total(previous[rule])} -> ${total(found[rule])}${added.length ? `, new entries: ${added.join(", ")}` : ""}`);
    }
    if (refused.length && !force) {
      console.error(`Refusing to write: ${refused.join(", ")} grew. Fix the new violations, or pass --force with the owner's OK.`);
      process.exit(1);
    }
  } else report(found);
  writeFileSync(ROOT + BASELINE_PATH, JSON.stringify(found, null, 2) + "\n");
  console.log(`Wrote ${BASELINE_PATH} from ${fromHead ? "HEAD" : "the git index"}: ${scoreboard(found)}`);
}

const fromHead = process.argv.includes("--from-head");
if (process.argv.includes("--write-baseline")) {
  writeBaseline(fromHead, process.argv.includes("--force"));
} else if (process.argv.includes("--report")) {
  const found = sorted(findViolations(fromHead ? committedFiles(true) : workingTreeFiles()));
  report(found);
  const problems = compare(JSON.parse(readFileSync(ROOT + BASELINE_PATH, "utf8")), found);
  console.log(problems.length ? `\nAgainst the baseline:\n${problems.join("\n")}` : "\nMatches the baseline.");
  process.exitCode = problems.length ? 1 : 0;
} else {
  const violationsOf = (path, src) => {
    const found = {};
    checkFile(path, src, (rule, _, n) => {
      if (n > 0) found[rule] = (found[rule] ?? 0) + n;
    });
    return found;
  };
  test("a closing JSX tag doesn't hide a comment after it", () => {
    assert.deepEqual(violationsOf("apps/browser/src/components/hello/Hello.tsx", "<Text>Hello</Text>; // comment\n"), { comments: 1 });
  });
  test("a closing JSX tag doesn't hide a colour after it", () => {
    assert.deepEqual(violationsOf("apps/browser/src/components/hello/Hello.tsx", '<Text>Hello</Text>; const color = "#ff0000";\n'), { tokens: 1 });
  });
  test("an import of a layer's own folder maps to that layer", () => {
    assert.deepEqual(violationsOf("apps/browser/src/components/ui/Button.tsx", 'import { Box } from ".";\n'), {});
    assert.deepEqual(violationsOf("apps/browser/src/platform/launchConfig.ts", 'import { keys } from "../lib";\n'), {});
  });
  test("a store is created curried, with no set/get creator", () => {
    const store = (body) => violationsOf("apps/browser/src/state/hello/store.ts", `import { create } from "zustand";\n${body}\n`);
    assert.deepEqual(store("export const useA = create<{ a: number }>()(() => ({ a: 1 }));"), {});
    assert.deepEqual(store("export const useA = create<Record<string, number>>()(() => ({}));"), {});
    assert.deepEqual(store("export const useA = create<{ a: number }>(() => ({ a: 1 }));"), { "store-shape": 1 });
    assert.deepEqual(store("export const useA = create<{ a: number }>()((set) => ({ a: 1 }));"), { "store-shape": 1 });
    assert.deepEqual(store("export const useA = create((set) => ({ a: 1 }));"), { "store-shape": 1 });
  });
  test("an interpolation after # in a string isn't a colour", () => {
    assert.deepEqual(violationsOf("apps/browser/src/state/hello/ids.ts", "export const id = (repo: string, n: number) => `${repo}#${n}`;\n"), {});
    assert.deepEqual(violationsOf("apps/browser/src/state/hello/ids.ts", 'export const plum = "#C07A98";\n'), { tokens: 1 });
    assert.deepEqual(violationsOf("apps/browser/src/state/hello/ids.ts", "export const anchor = (id: string) => `#${id}`;\n"), {});
  });
  test("a hex string interpolated after # is still a colour", () => {
    assert.deepEqual(violationsOf("apps/browser/src/state/hello/colors.ts", 'export const white = `#${"fff"}`;\n'), { tokens: 1 });
    assert.deepEqual(violationsOf("apps/browser/src/state/hello/colors.ts", 'const hex = "fff";\nexport const color = `#${hex}`;\n'), { tokens: 1 });
  });
  test("a forward declaration of the engine's ArdiaCore classes isn't an app-side class", () => {
    assert.deepEqual(violationsOf("packages/hello/ios/HelloWindow.h", "@class ArdiaCoreTab;\n"), {});
    assert.deepEqual(violationsOf("packages/hello/ios/HelloWindow.h", "@interface ArdiaCoreHello : NSObject\n@end\n"), { naming: 1 });
  });
  test("components neither write a store nor subscribe to the workspace store directly", () => {
    const component = (body) => violationsOf("apps/browser/src/components/hello/Hello.tsx", `${body}\n`);
    assert.deepEqual(component("useSidebarUi.setState({ hover: null });"), { "set-state": 1 });
    assert.deepEqual(component("const tab = useBrowser((s) => s.tabs[id]);"), { "store-reads": 1 });
    assert.deepEqual(component("const tab = useTab(id, (t) => t?.title);"), {});
  });
  test("components reach platform/ only through state, except the dev harness", () => {
    const imports = (path, spec) => violationsOf(path, `import { webviews } from "${spec}";\n`);
    assert.deepEqual(imports("apps/browser/src/components/find/FindBar.tsx", "../../platform/webviews"), { imports: 1 });
    assert.deepEqual(imports("apps/browser/src/components/settings/panes/Passwords.tsx", "../../../platform/importModule"), { imports: 1 });
    assert.deepEqual(imports("apps/browser/src/components/find/FindBar.tsx", "../../state/tabs/webviewHandles"), {});
    assert.deepEqual(imports("apps/browser/src/components/dev/devHarness.ts", "../../platform/webviews"), {});
    assert.deepEqual(imports("apps/browser/src/components/dev/DevPanel.tsx", "../../platform/webviews"), { imports: 1 });
    assert.deepEqual(imports("apps/browser/src/state/tabs/webviewHandles.ts", "../../platform/webviews"), {});
  });
  test("only the engine's named environment reads are exempt", () => {
    const delegate = "engine/ardiacore/src/ardia/core/ac_main_delegate.cc";
    const policy = "engine/chromium/src/chrome/browser/ardia/ac_scripts_policy.cc";
    const create = "  std::unique_ptr<base::Environment> env = base::Environment::Create();\n";
    assert.deepEqual(violationsOf(delegate, create), {});
    assert.deepEqual(violationsOf(delegate, `${create}  const char* port = getenv("PORT");\n`), { env: 1 });
    assert.deepEqual(violationsOf(policy, '    if (const char* home = getenv("HOME")) {\n'), {});
    assert.deepEqual(violationsOf(policy, '    const char* user = getenv("USER");\n'), { env: 1 });
    assert.deepEqual(violationsOf("engine/chromium/src/chrome/browser/ardia/ac_other.cc", '    if (const char* home = getenv("HOME")) {\n'), { env: 1 });
  });
  test("conventions hold, except what the baseline lists", (t) => {
    const baseline = JSON.parse(readFileSync(ROOT + BASELINE_PATH, "utf8"));
    const found = findViolations(workingTreeFiles());
    t.diagnostic(scoreboard(found));
    const problems = compare(baseline, found);
    assert.equal(
      problems.length,
      0,
      `Conventions check (docs/conventions.md). New violations fail; fixed ones must leave the baseline (node apps/browser/src/conventions.test.mjs --write-baseline):\n${problems.join("\n")}`,
    );
  });
}
