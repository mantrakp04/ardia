import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const shell = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(shell, path), "utf8");
const body = (source, signature) => source.match(new RegExp(`${signature}[^\\n]*\\{\\n([\\s\\S]*?)\\n  \\}`))?.[1] ?? "";

test("the Dock icon and the Dock tile plug-in show the default icon under Tinted and Clear", () => {
  assert.match(body(read("ios/AppIcons.swift"), "private static func apply\\(\\)"), /IconStyle\.shown\(saved: /, "AppIcons.apply ignores the system icon style");
  assert.match(body(read("docktile/DockTilePlugIn.swift"), "private func show\\(\\)"), /IconStyle\.shown\(saved: /, "the plug-in's show ignores the system icon style");
});

test("both re-show the icon when the system icon style changes", () => {
  assert.match(read("ios/AppIcons.swift"), /IconStyleWatcher\s*[({]/);
  assert.match(read("docktile/DockTilePlugIn.swift"), /IconStyleWatcher\s*[({]/);
});

test("the Dock tile plug-in is built with the icon style rule", () => {
  assert.match(read("docktile/build.sh"), /sources=\([^)]*UpdaterCore\/IconStyle\.swift/);
});

test("Tinted and Clear show the default icon, Regular, Dark and unknown styles keep the saved one", () => {
  const work = mkdtempSync(join(tmpdir(), "ardia-icon-style-"));
  try {
    writeFileSync(
      join(work, "main.swift"),
      [
        "import Foundation",
        "while let line = readLine() {",
        '  let parts = line.split(separator: "\\t", omittingEmptySubsequences: false).map(String.init)',
        '  let theme: String? = parts[1] == "-" ? nil : parts[1]',
        '  print(IconStyle.shown(saved: parts[0], theme: theme), IconStyle.restylesIcons(theme: theme))',
        "}",
        "",
      ].join("\n"),
    );
    execFileSync("swiftc", [join(shell, "ios/UpdaterCore/IconStyle.swift"), join(work, "main.swift"), "-o", join(work, "probe")], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    const cases = [
      ["mono", "-", "mono", false],
      ["mono", "RegularLight", "mono", false],
      ["mono", "RegularDark", "mono", false],
      ["mono", "FutureStyle", "mono", false],
      ["mono", "TintedLight", "default", true],
      ["mono", "TintedDark", "default", true],
      ["mono", "TintedAutomatic", "default", true],
      ["mono", "ClearLight", "default", true],
      ["mono", "ClearDark", "default", true],
      ["midnight", "ClearAutomatic", "default", true],
      ["default", "TintedLight", "default", true],
      ["default", "-", "default", false],
    ];
    const output = execFileSync(join(work, "probe"), { input: cases.map(([saved, theme]) => `${saved}\t${theme}`).join("\n") + "\n", encoding: "utf8" });
    assert.deepEqual(
      output.trim().split("\n"),
      cases.map(([, , shown, restyles]) => `${shown} ${restyles}`),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
