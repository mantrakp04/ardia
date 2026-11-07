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

const probe = (lines) => {
  const work = mkdtempSync(join(tmpdir(), "ardia-icon-style-"));
  try {
    writeFileSync(
      join(work, "main.swift"),
      [
        "import Foundation",
        'func theme(_ field: Substring) -> String? { field == "-" ? nil : String(field) }',
        "while let line = readLine() {",
        '  let parts = line.split(separator: "\\t", omittingEmptySubsequences: false)',
        "  switch parts[0] {",
        '  case "shown":',
        "    let style = theme(parts[2])",
        "    print(IconStyle.shown(saved: String(parts[1]), theme: style), IconStyle.restylesIcons(theme: style))",
        '  case "track":',
        "    var calls = 0",
        "    let tracker = IconStyleTracker(theme: theme(parts[1])) { calls += 1 }",
        '    for next in parts[2].split(separator: ",") { tracker.themeChanged(to: theme(next)) }',
        "    print(calls)",
        "  default:",
        '    fatalError("unknown probe line")',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    execFileSync("swiftc", [join(shell, "ios/UpdaterCore/IconStyle.swift"), join(work, "main.swift"), "-o", join(work, "probe")], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    return execFileSync(join(work, "probe"), { input: lines.join("\n") + "\n", encoding: "utf8" }).trim().split("\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

test("the Dock icon and the Dock tile plug-in show the default icon under Tinted and Clear", () => {
  assert.match(body(read("ios/AppIcons.swift"), "private static func apply\\(\\)"), /IconStyle\.shown\(saved: /, "AppIcons.apply ignores the system icon style");
  assert.match(body(read("docktile/DockTilePlugIn.swift"), "private func show\\(\\)"), /IconStyle\.shown\(saved: /, "the plug-in's show ignores the system icon style");
});

test("a system icon style change re-applies the app icon and re-shows the Dock tile", () => {
  assert.match(read("ios/AppIcons.swift"), /styleWatcher = IconStyleWatcher\s*\{\s*apply\(\)\s*\}/, "AppIcons does not re-apply the icon when the style changes");
  assert.match(
    read("docktile/DockTilePlugIn.swift"),
    /styleWatcher = IconStyleWatcher\s*\{\s*\[weak self\] in\s*self\?\.show\(\)\s*\}/,
    "the plug-in does not re-show the Dock tile when the style changes",
  );
  const watcher = read("ios/AppIcons.swift").match(/final class IconStyleWatcher[\s\S]*$/)?.[0] ?? "";
  assert.match(watcher, /forKeyPath: IconStyle\.defaultsKey/, "the watcher does not observe the system icon style");
  assert.match(watcher, /IconStyleTracker\(theme: IconStyle\.systemTheme, onChange: onChange\)/, "the watcher does not hand its callback to the tracker");
  assert.match(watcher, /tracker\.themeChanged\(to: IconStyle\.systemTheme\)/, "the watcher does not report the new style to the tracker");
});

test("the style is watched before the icon is reconciled, so a change in between is not missed", () => {
  const restore = body(read("ios/AppIcons.swift"), "static func restore\\(\\)");
  assert.ok(restore.includes("watchStyle()") && restore.includes("apply()"), "restore must watch the style and apply the icon");
  assert.ok(restore.indexOf("watchStyle()") < restore.indexOf("apply()"), "AppIcons.restore applies the icon before watching the style");
  const dockTile = body(read("docktile/DockTilePlugIn.swift"), "func setDockTile\\(");
  assert.ok(dockTile.includes("styleWatcher = IconStyleWatcher") && dockTile.includes("show()"), "setDockTile must watch the style and show the tile");
  assert.ok(dockTile.indexOf("styleWatcher = IconStyleWatcher") < dockTile.lastIndexOf("show()"), "the plug-in shows the tile before watching the style");
});

test("the Dock tile plug-in is built with the icon style rule", () => {
  assert.match(read("docktile/build.sh"), /sources=\([^)]*UpdaterCore\/IconStyle\.swift/);
});

test("Tinted and Clear show the default icon, Regular, Dark and unknown styles keep the saved one", () => {
  const cases = [
    ["mono", "-", "mono", false],
    ["mono", "RegularLight", "mono", false],
    ["mono", "RegularDark", "mono", false],
    ["mono", "FutureStyle", "mono", false],
    ["mono", "TintedLight", "default", true],
    ["mono", "TintedDark", "default", true],
    ["mono", "TintedAutomatic", "default", true],
    ["mono", "TintedFuture", "default", true],
    ["mono", "ClearLight", "default", true],
    ["mono", "ClearDark", "default", true],
    ["midnight", "ClearAutomatic", "default", true],
    ["default", "TintedLight", "default", true],
    ["default", "-", "default", false],
  ];
  assert.deepEqual(
    probe(cases.map(([saved, theme]) => `shown\t${saved}\t${theme}`)),
    cases.map(([, , shown, restyles]) => `${shown} ${restyles}`),
  );
});

test("the tracker calls back once each time the style crosses between restyled and not", () => {
  const cases = [
    ["RegularLight", "RegularDark,RegularLight,RegularAutomatic", 0],
    ["RegularLight", "TintedLight", 1],
    ["RegularLight", "TintedLight,TintedLight", 1],
    ["RegularLight", "TintedLight,TintedDark,ClearLight", 1],
    ["RegularLight", "TintedLight,RegularLight", 2],
    ["RegularLight", "ClearDark,RegularDark,TintedDark", 3],
    ["TintedLight", "ClearLight", 0],
    ["TintedLight", "RegularLight", 1],
    ["-", "TintedLight", 1],
    ["TintedLight", "-", 1],
    ["-", "-", 0],
  ];
  assert.deepEqual(
    probe(cases.map(([initial, changes]) => `track\t${initial}\t${changes}`)),
    cases.map(([, , calls]) => String(calls)),
  );
});
