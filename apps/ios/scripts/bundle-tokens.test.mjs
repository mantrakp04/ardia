import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadMacTokens, renderSwift, swiftColor, swiftNumber } from "./bundle-tokens.mjs";

function inScratch(use) {
  const base = mkdtempSync(join(tmpdir(), "bundle-tokens-"));
  try {
    return use(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const loadSources = (files) =>
  inScratch((base) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(base, path)), { recursive: true });
      writeFileSync(join(base, path), text);
    }
    return loadMacTokens({ base, sources: { main: "main.ts" } }).main;
  });

const VALUES = "export const a = 1;\nexport const b = 2;\n";

test("reads the Mac's radii, spacing and type scale", () => {
  const mac = loadMacTokens();
  assert.equal(mac.tokens.radius.chrome, 10);
  assert.equal(mac.tokens.space.ml, 10);
  assert.equal(mac.tokens.font.body.fontSize, 13);
  assert.equal(mac.tokens.display.large.letterSpacing, -0.4);
  assert.equal(mac.tokens.weight.semibold, "600");
});

test("reads the Mac's springs, durations and the sidebar dock spring", () => {
  const mac = loadMacTokens();
  assert.deepEqual(mac.motion.springSpec.snappy, { response: 0.2, damping: 0.9 });
  assert.equal(mac.motion.duration.base, 150);
  assert.deepEqual(mac.window.DOCK_SPRING, { response: 0.215, damping: 0.79 });
});

test("reads both colour schemes", () => {
  const mac = loadMacTokens();
  assert.equal(mac.tokens.colorRoles.dark.textTab, "#FFFFFFC7");
  assert.equal(mac.tokens.colorRoles.light.destructive, "#FF3B30");
});

test("colours keep their channels and their alpha", () => {
  assert.equal(swiftColor("#FFFFFFC7"), "TokenColor(hex: 0xFFFFFF, opacity: 0.7804)");
  assert.equal(swiftColor("rgba(18,18,18,0.5)"), "TokenColor(hex: 0x121212, opacity: 0.5)");
  assert.equal(swiftColor("#2A2A2A"), "TokenColor(hex: 0x2A2A2A, opacity: 1)");
});

test("numbers print as Swift literals", () => {
  assert.equal(swiftNumber(2), "2");
  assert.equal(swiftNumber(-0.4), "-0.4");
  assert.equal(swiftNumber(0.0060000001), "0.006");
});

test("the Swift output carries the values views will use", () => {
  const swift = renderSwift(loadMacTokens());
  assert.match(swift, /public static let chrome: CGFloat = 10\n/);
  assert.match(swift, /public static let xxs: CGFloat = 2\n/);
  assert.match(swift, /public static let snappy = SpringToken\(response: 0\.2, dampingFraction: 0\.9\)\n/);
  assert.match(swift, /public static let sidebarDock = SpringToken\(response: 0\.215, dampingFraction: 0\.79\)\n/);
  assert.match(swift, /public static let sidebarPeek = SpringToken\(response: 0\.18, dampingFraction: 0\.8\)\n/);
  assert.match(swift, /public static let sidebarPeekOut: Double = 0\.15\n/);
  assert.match(swift, /public static let base: Double = 0\.15\n/);
  assert.match(swift, /public static let textTertiary = SchemeColor\(dark: TokenColor\(hex: 0xFFFFFF, opacity: 0\.349\), light: TokenColor\(hex: 0x000000, opacity: 0\.349\)\)\n/);
  assert.match(swift, /public static let tabSelectedBorderTop = SchemeColor\(/);
  assert.match(swift, /public static let controlPressed = SchemeColor\(dark: TokenColor\(hex: 0xFFFFFF, opacity: 0\.2\), light: TokenColor\(hex: 0xEBEBEB, opacity: 1\)\)\n/);
  assert.doesNotMatch(swift, /\/\//);
});

test("a multi-line import goes through the real loader", () => {
  const main = loadSources({ "main.ts": 'import {\n  a,\n  b as c,\n} from "./values";\nexport const sum = a + c;\n', "values.ts": VALUES });
  assert.equal(main.sum, 3);
});

test("a namespace import goes through the real loader", () => {
  const main = loadSources({ "main.ts": 'import * as values from "./values";\nexport const sum = values.a + values.b;\n', "values.ts": VALUES });
  assert.equal(main.sum, 3);
});

test("an import of a module the generator can't evaluate names the file and line", () => {
  assert.throws(() => loadSources({ "main.ts": 'export const a = 1;\nimport { thing } from "./elsewhere";\n' }), /main\.ts:2 imports \.\/elsewhere/);
  assert.throws(() => loadSources({ "main.ts": 'import { View } from "react-native-svg";\n' }), /main\.ts:1 imports react-native-svg/);
});

test("a react-native export the generator does not stub names the file and line", () => {
  const source = 'import { Easing } from "react-native";\nimport { Platform } from "react-native";\nexport const os = Platform.OS;\n';
  assert.throws(() => loadSources({ "main.ts": source }), /main\.ts:2 imports Platform from react-native/);
});

test("a name the imported module does not export names the file and line", () => {
  assert.throws(() => loadSources({ "main.ts": 'import { missing } from "./values";\n', "values.ts": VALUES }), /main\.ts:1 imports missing from \.\/values/);
});

test("an import or export form the generator does not know names the file and line", () => {
  assert.throws(() => loadSources({ "main.ts": 'export const a = 1;\nimport thing from "./values";\n', "values.ts": VALUES }), /main\.ts:2: an import form/);
  assert.throws(() => loadSources({ "main.ts": "const a = 1;\n\nexport default a;\n" }), /main\.ts:3: an export form/);
});

test("the script runs when it is started through a symlink", () => {
  const run = inScratch((base) => {
    const link = join(base, "bundle-tokens.mjs");
    symlinkSync(fileURLToPath(new URL("./bundle-tokens.mjs", import.meta.url)), link);
    return spawnSync(process.execPath, ["--no-warnings", link, "--help"], { encoding: "utf8" });
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /^Usage: node apps\/ios\/scripts\/bundle-tokens\.mjs/);
});

test("a colour out of range or in a form the generator does not read fails loudly", () => {
  assert.throws(() => swiftColor("rgba(255,255,256,0.1)"), /rgba\(255,255,256,0\.1\)/);
  assert.throws(() => swiftColor("rgba(0,0,0,1.5)"), /rgba\(0,0,0,1\.5\)/);
  assert.throws(() => swiftColor("rgb(0 0 0 / 0.5)"), /rgb\(0 0 0 \/ 0\.5\)/);
  assert.throws(() => swiftColor("rgba(0,0,,0.5)"), /rgba\(0,0,,0\.5\)/);
  assert.throws(() => swiftColor("#12345"), /#12345/);
  assert.throws(() => swiftColor("white"), /white/);
});

test("short hex colours expand the way the Mac's parser does", () => {
  assert.equal(swiftColor("#FFF"), "TokenColor(hex: 0xFFFFFF, opacity: 1)");
  assert.equal(swiftColor("#0008"), "TokenColor(hex: 0x000000, opacity: 0.5333)");
});

test("small numbers keep four significant digits instead of becoming zero", () => {
  assert.equal(swiftNumber(0.00001), "0.00001");
  assert.equal(swiftNumber(0.000012), "0.000012");
  assert.equal(swiftNumber(0.7803921568627451), "0.7804");
  assert.equal(swiftNumber(1376), "1376");
  assert.equal(swiftNumber(-0.4), "-0.4");
});

test("an unknown font family fails loudly instead of guessing", () => {
  const mac = loadMacTokens();
  const odd = { ...mac, tokens: { ...mac.tokens, display: { ...mac.tokens.display, title: { fontSize: 22, fontFamily: "Papyrus" } } } };
  assert.throws(() => renderSwift(odd), /Papyrus/);
});
