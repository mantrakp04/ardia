import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const scripts = new URL(".", import.meta.url).pathname;
const symbolicate = join(scripts, "symbolicate-crash.sh");
const packSymbols = join(scripts, "lib/pack-symbols.sh");

const FRAMEWORK_UUID = "4c4c44f3-5555-3144-a138-48cce2a582ef";
const NEWER_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const LIBRARY_UUID = "11111111-2222-3333-4444-555555555555";

const stubs = {
  gh: `#!/usr/bin/env bash
echo "gh $*" >>"$STUB_LOG"
case "$1 $2" in
  "release list") cat "$STUB_RELEASES" ;;
  "release download")
    tag="$3"; shift 3
    pattern="" dir=""
    while [ $# -gt 0 ]; do
      case "$1" in -p) pattern="$2"; shift ;; -D) dir="$2"; shift ;; esac
      shift
    done
    [ -f "$STUB_ASSETS/$tag/$pattern" ] || { echo "release asset not found" >&2; exit 1; }
    cp "$STUB_ASSETS/$tag/$pattern" "$dir/"
    ;;
  *) echo "unexpected: gh $*" >&2; exit 2 ;;
esac
`,
  dwarfdump: `#!/usr/bin/env bash
[ "$1" = "--uuid" ] || exit 2
id="$(sed -n 's/^uuid://p' "$2")"
[ -n "$id" ] || { echo "not a Mach-O file" >&2; exit 1; }
echo "UUID: $(echo "$id" | tr 'a-f' 'A-F') (arm64) $2"
`,
  atos: `#!/usr/bin/env bash
echo "atos $*" >>"$STUB_LOG"
shift 6
for address in "$@"; do
  case "$address" in
    0x0) echo "$address" ;;
    *) echo "frame_$address (in Chromium Framework) (stub.cc:1)" ;;
  esac
done
`,
};

let work, bin, assets, cache, env;

const writeImage = (dir, rel, uuid) => {
  const path = join(dir, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `uuid:${uuid}\nnot a real binary\n`);
};

const run = (script, args, extra = {}) =>
  spawnSync(script, args, { encoding: "utf8", env: { ...env, ...extra } });

const publish = (tag, images) => {
  const symbols = join(work, `symbols-${tag}`);
  for (const [rel, uuid] of Object.entries(images)) writeImage(symbols, rel, uuid);
  const short = tag.replace(/^engine-/, "");
  const dir = join(assets, tag);
  mkdirSync(dir, { recursive: true });
  const packed = run(packSymbols, [symbols, join(dir, `ArdiaCore-${short}-symbols.tar.xz`), join(dir, `ArdiaCore-${short}-uuids.txt`)]);
  assert.equal(packed.status, 0, packed.stderr);
  return dir;
};

const downloads = (pattern) =>
  readFileSync(env.STUB_LOG, "utf8").split("\n").filter((line) => line.startsWith("gh release download") && line.includes(pattern));

before(() => {
  work = mkdtempSync(join(tmpdir(), "symbolicate-test-"));
  bin = join(work, "bin");
  assets = join(work, "assets");
  cache = join(work, "cache");
  mkdirSync(bin);
  for (const [name, source] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), source);
    chmodSync(join(bin, name), 0o755);
  }
  env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    STUB_LOG: join(work, "stub.log"),
    STUB_ASSETS: assets,
    STUB_RELEASES: join(work, "releases.txt"),
  };
  writeFileSync(env.STUB_LOG, "");
  writeFileSync(env.STUB_RELEASES, ["engine-bbbbbbbbbbbb", "v0.2.43", "engine-cccccccccccc", "engine-aaaaaaaaaaaa", ""].join("\n"));
  publish("engine-bbbbbbbbbbbb", { "Chromium Framework": NEWER_UUID });
  publish("engine-aaaaaaaaaaaa", {
    "Chromium Framework": FRAMEWORK_UUID,
    "Libraries/libfoo.dylib": LIBRARY_UUID,
    "Helpers/chrome_crashpad_handler": "99999999-8888-7777-6666-555555555555",
  });
  const mismatched = publish("engine-dddddddddddd", { "Chromium Framework": "dddddddd-dddd-dddd-dddd-dddddddddddd" });
  cpSync(join(assets, "engine-aaaaaaaaaaaa/ArdiaCore-aaaaaaaaaaaa-symbols.tar.xz"), join(mismatched, "ArdiaCore-dddddddddddd-symbols.tar.xz"));
});

after(() => rmSync(work, { recursive: true, force: true }));

test("pack-symbols lists every image's UUID and packs the unstripped files", () => {
  const dir = join(assets, "engine-aaaaaaaaaaaa");
  const rows = readFileSync(join(dir, "ArdiaCore-aaaaaaaaaaaa-uuids.txt"), "utf8").trimEnd().split("\n");
  assert.deepEqual(rows, [
    `${FRAMEWORK_UUID}\tarm64\tChromium Framework`,
    "99999999-8888-7777-6666-555555555555\tarm64\tHelpers/chrome_crashpad_handler",
    `${LIBRARY_UUID}\tarm64\tLibraries/libfoo.dylib`,
  ]);
  const members = execFileSync("tar", ["-tJf", join(dir, "ArdiaCore-aaaaaaaaaaaa-symbols.tar.xz")], { encoding: "utf8" }).trimEnd().split("\n");
  assert.deepEqual(members, ["Chromium Framework", "Helpers/chrome_crashpad_handler", "Libraries/libfoo.dylib"]);
});

test("pack-symbols refuses a folder with no Chromium Framework, or an image with no UUID", () => {
  const empty = join(work, "symbols-empty");
  writeImage(empty, "Libraries/libfoo.dylib", LIBRARY_UUID);
  const missing = run(packSymbols, [empty, join(work, "e.tar.xz"), join(work, "e.txt")]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /holds no Chromium Framework/);
  assert.equal(existsSync(join(work, "e.txt")), false);

  const broken = join(work, "symbols-broken");
  writeImage(broken, "Chromium Framework", FRAMEWORK_UUID);
  writeFileSync(join(broken, "Libraries.txt"), "not an image\n");
  const bad = run(packSymbols, [broken, join(work, "b.tar.xz"), join(work, "b.txt")]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /dwarfdump --uuid failed on Libraries\.txt/);
  assert.equal(existsSync(join(work, "b.txt")), false);
});

test("a crash's image UUID and offsets resolve through the engine release that holds them", () => {
  const result = run(symbolicate, ["--cache", cache, FRAMEWORK_UUID.toUpperCase(), "0x2e2334", "+0x3cae9d8"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "0x2e2334\tframe_0x2e2334 (in Chromium Framework) (stub.cc:1)\n0x3cae9d8\tframe_0x3cae9d8 (in Chromium Framework) (stub.cc:1)\n",
  );
  assert.match(result.stderr, new RegExp(`Chromium Framework \\(${FRAMEWORK_UUID}, arm64\\) from engine-aaaaaaaaaaaa`));
  const log = readFileSync(env.STUB_LOG, "utf8");
  assert.ok(log.includes(`atos -arch arm64 -o ${join(cache, "engine-aaaaaaaaaaaa/symbols/Chromium Framework")} -l 0x0 0x2e2334 0x3cae9d8\n`), log);
  assert.equal(downloads("-symbols.tar.xz").length, 1);
});

test("a second run reuses the downloaded symbols, and finds other images of the same engine", () => {
  const before = downloads("-symbols.tar.xz").length;
  const again = run(symbolicate, ["--cache", cache, FRAMEWORK_UUID, "0xda7240"]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(downloads("-symbols.tar.xz").length, before);

  const library = run(symbolicate, ["--cache", cache, LIBRARY_UUID, "0x10"]);
  assert.equal(library.status, 0, library.stderr);
  assert.match(library.stderr, /Libraries\/libfoo\.dylib .* from engine-aaaaaaaaaaaa/);
  assert.equal(downloads("-symbols.tar.xz").length, before + 1);
});

test("--tag goes straight to one engine release", () => {
  const cold = join(work, "cache-tag");
  const logged = readFileSync(env.STUB_LOG, "utf8").length;
  const result = run(symbolicate, ["--tag", "engine-bbbbbbbbbbbb", "--cache", cold, NEWER_UUID, "0x54cc"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /from engine-bbbbbbbbbbbb/);
  assert.doesNotMatch(readFileSync(env.STUB_LOG, "utf8").slice(logged), /release list/);

  const wrong = run(symbolicate, ["--tag", "engine-bbbbbbbbbbbb", "--cache", cold, FRAMEWORK_UUID, "0x54cc"]);
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /engine-bbbbbbbbbbbb's symbols don't list the image/);

  const none = run(symbolicate, ["--tag", "engine-cccccccccccc", "--cache", cold, FRAMEWORK_UUID, "0x54cc"]);
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /engine-cccccccccccc has no ArdiaCore-cccccccccccc-uuids\.txt/);
});

test("an offset atos cannot name is reported, not hidden", () => {
  const result = run(symbolicate, ["--cache", cache, FRAMEWORK_UUID, "0x0", "0x8502c6c"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^0x0\t0x0\n0x8502c6c\tframe_0x8502c6c/);
  assert.match(result.stderr, /atos couldn't name 1 of 2 offsets in Chromium Framework/);
});

test("an image no engine release lists is an error that says so", () => {
  const result = run(symbolicate, ["--cache", cache, "00000000-0000-0000-0000-000000000000", "0x1"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no engine release lists the image 00000000-0000-0000-0000-000000000000/);
});

test("symbols that don't hold the UUID their release lists are refused", () => {
  writeFileSync(
    join(assets, "engine-dddddddddddd/ArdiaCore-dddddddddddd-uuids.txt"),
    `dddddddd-dddd-dddd-dddd-dddddddddddd\tarm64\tChromium Framework\n`,
  );
  const result = run(symbolicate, ["--tag", "engine-dddddddddddd", "--cache", join(work, "cache-mismatch"), "dddddddd-dddd-dddd-dddd-dddddddddddd", "0x1"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`Chromium Framework in engine-dddddddddddd has UUID ${FRAMEWORK_UUID}, not dddddddd-dddd-dddd-dddd-dddddddddddd`));
});

test("it rejects a malformed UUID or offset before calling anything", () => {
  const size = readFileSync(env.STUB_LOG, "utf8").length;
  const uuid = run(symbolicate, ["--cache", cache, "4c4c44f3", "0x1"]);
  assert.notEqual(uuid.status, 0);
  assert.match(uuid.stderr, /isn't an image UUID/);
  const offset = run(symbolicate, ["--cache", cache, FRAMEWORK_UUID, "2e2334"]);
  assert.notEqual(offset.status, 0);
  assert.match(offset.stderr, /isn't a hex offset/);
  const missing = run(symbolicate, [FRAMEWORK_UUID]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /usage: scripts\/symbolicate-crash\.sh/);
  assert.equal(readFileSync(env.STUB_LOG, "utf8").length, size);
});

test("--help prints the header", () => {
  const result = run(symbolicate, ["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Names the frames of a native crash/);
  assert.match(result.stdout, /scripts\/symbolicate-crash\.sh \[--tag <engine-tag>\]/);
});

test("publish-engine.sh packs the symbols after stripping and uploads them with the engine", () => {
  const source = readFileSync(join(scripts, "publish-engine.sh"), "utf8");
  const strip = source.indexOf('strip-engine.sh" "$work/Ardia.app" "$out/symbols"');
  const pack = source.indexOf('pack-symbols.sh" "$out/symbols" "$symbols_archive" "$uuids_file"');
  assert.ok(strip > 0 && pack > strip, "pack-symbols.sh runs on the folder strip-engine.sh filled");
  assert.match(source, /^symbols_archive="\$out\/\$\(engine_symbols_name "\$tag"\)"$/m);
  assert.match(source, /^uuids_file="\$out\/\$\(engine_uuids_name "\$tag"\)"$/m);
  assert.match(source, /^assets=\("\$archive" "\$archive\.sha256" "\$symbols_archive" "\$uuids_file"\)$/m);
  assert.match(source, /^run gh release upload "\$tag" -R "\$REPO" --clobber "\$\{assets\[@\]\}"$/m);
});

test("the release names the symbolicate script looks for are the ones publish-engine.sh uploads", () => {
  const names = execFileSync("bash", ["-c", `. "${join(scripts, "lib/releases.sh")}"; engine_symbols_name engine-4f3a9c0d1e2b; engine_uuids_name engine-4f3a9c0d1e2b`], {
    encoding: "utf8",
  }).trimEnd().split("\n");
  assert.deepEqual(names, ["ArdiaCore-4f3a9c0d1e2b-symbols.tar.xz", "ArdiaCore-4f3a9c0d1e2b-uuids.txt"]);
});
