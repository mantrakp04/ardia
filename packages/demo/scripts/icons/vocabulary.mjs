import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const CORE_GLYPHS = "/System/Library/CoreServices/CoreGlyphs.bundle/Contents/Resources";

export const hasVocabulary = () => existsSync(`${CORE_GLYPHS}/name_availability.plist`);

function plistJson(file) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", `${CORE_GLYPHS}/${file}`], { encoding: "utf8", maxBuffer: 64 << 20 }));
}

export function symbolVocabulary() {
  const names = new Set(Object.keys(plistJson("name_availability.plist").symbols));
  for (const alias of Object.keys(plistJson("name_aliases.strings"))) names.add(alias);
  return names;
}
