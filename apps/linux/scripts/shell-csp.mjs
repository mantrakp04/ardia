import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const nativeHostSource = fileURLToPath(new URL("../../../engine/ardiacore-linux/src/ardia/linux/ac_linux_host.cc", import.meta.url));

const DATA_SOURCE_DEFAULTS = ["require-trusted-types-for 'script';"];

export function shellPolicyDirectives(source = readFileSync(nativeHostSource, "utf8")) {
  const start = source.indexOf("class ShellDataSource");
  const end = source.indexOf("StartDataRequest", start);
  if (start < 0 || end < 0) throw new Error("The native shell data source was not found");
  const body = source.slice(start, end);
  const directives = new Map();
  for (const match of body.matchAll(/case Directive::(\w+):\s*return\s+((?:"[^"]*"\s*)+);/g)) {
    directives.set(match[1], [...match[2].matchAll(/"([^"]*)"/g)].map((part) => part[1]).join(""));
  }
  if (!directives.has("ConnectSrc") || !directives.has("DefaultSrc")) throw new Error("The native shell policy is incomplete");
  return directives;
}

export function shellContentSecurityPolicy(source) {
  return [...shellPolicyDirectives(source).values(), ...DATA_SOURCE_DEFAULTS].join(" ");
}

export function connectSources(source) {
  const directive = shellPolicyDirectives(source).get("ConnectSrc");
  const match = /^connect-src\s+(.*);$/.exec(directive);
  if (!match) throw new Error(`Malformed connect-src directive: ${directive}`);
  return match[1].trim().split(/\s+/);
}
