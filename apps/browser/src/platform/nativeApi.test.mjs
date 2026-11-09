import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the JS bundle and the native build declare the same API version", () => {
  const js = read("./nativeApi.ts").match(/export const NATIVE_API_VERSION = (\d+);/)?.[1];
  const native = read("../../../../packages/shell/ios/AppModule.swift").match(/Constant\("apiVersion"\) \{ \(\) -> Int in (\d+) \}/)?.[1];
  assert.ok(js && native, "both declarations found");
  assert.equal(js, native);
});

const packagesDir = new URL("../../../../packages/", import.meta.url);
const nativePackages = readdirSync(packagesDir).filter((name) => existsSync(new URL(`${name}/expo-module.config.json`, packagesDir)));

const registrationsIn = (where, source) => {
  const domain = source.match(/CallTable\(domain: "([a-zA-Z]+)"/)?.[1];
  const found = [];
  const branches = [];
  let owner = null;
  let groups = 0;
  for (const line of source.split("\n")) {
    owner = line.match(/^(?:(?:public|open|final) )*class (\w+)/)?.[1] ?? owner;
    const directive = line.trim().match(/^#(if|elseif|else|endif)\b/)?.[1];
    if (directive === "if") branches.push({ group: ++groups, arm: 0 });
    else if (directive === "elseif" || directive === "else") branches.at(-1).arm += 1;
    else if (directive === "endif") branches.pop();
    const name = line.match(/^ {4}Name\((?:"([^"]+)"|Self\.calls\.moduleName)\)/);
    if (name) found.push({ name: name[1] ?? `Ardia${domain[0].toUpperCase()}${domain.slice(1)}`, module: `${where} ${owner}`, branch: branches.map((b) => ({ ...b })) });
  }
  return found;
};

const exclusive = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].group !== b[i].group) return false;
    if (a[i].arm !== b[i].arm) return true;
  }
  return false;
};

const registrationProblems = (registrations) => {
  const problems = [];
  const byModule = Map.groupBy(registrations, (r) => r.module);
  for (const [module, own] of byModule) {
    for (let i = 0; i < own.length; i++)
      for (let j = i + 1; j < own.length; j++) if (!exclusive(own[i].branch, own[j].branch)) problems.push(`${module} registers twice: ${own[i].name}, ${own[j].name}`);
  }
  for (const [name, same] of Map.groupBy(registrations, (r) => r.name)) {
    const modules = [...new Set(same.map((r) => r.module))];
    if (modules.length > 1) problems.push(`${name}: ${modules.join(", ")}`);
  }
  return problems;
};

const declaredRegistrations = () =>
  nativePackages.flatMap((pkg) => {
    const ios = new URL(`${pkg}/ios/`, packagesDir);
    return readdirSync(ios, { recursive: true })
      .filter((file) => file.endsWith(".swift"))
      .flatMap((file) => registrationsIn(`${pkg}/ios/${file}`, readFileSync(new URL(file, ios), "utf8")));
  });

const duplicates = (entries) => {
  const seen = new Map();
  for (const { key, where } of entries) seen.set(key, new Set([...(seen.get(key) ?? []), where]));
  return [...seen].filter(([, places]) => places.size > 1).map(([key, places]) => `${key}: ${[...places].join(", ")}`);
};

test("no two Expo modules register the same name, so neither shadows the other", () => {
  const registrations = declaredRegistrations();
  const names = new Set(registrations.map((r) => r.name));
  assert.ok(names.has("ArdiaShell") && names.has("ArdiaWindows"), "found the shell and ArdiaCore modules");
  assert.deepEqual(registrationProblems(registrations), []);
});

test("the module-name check tells modules apart by class, not file, and lets exclusive #if branches repeat a name", () => {
  const twoInOneFile = `public class FirstModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaSame")
  }
}

public class SecondModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaSame")
  }
}
`;
  assert.deepEqual(registrationProblems(registrationsIn("fixture/Two.swift", twoInOneFile)), [
    "ArdiaSame: fixture/Two.swift FirstModule, fixture/Two.swift SecondModule",
  ]);
  const debugAndRelease = `public class DevModule: Module {
  #if DEBUG
  public func definition() -> ModuleDefinition {
    Name("ArdiaDev")
  }
  #else
  public func definition() -> ModuleDefinition {
    Name("ArdiaDev")
  }
  #endif
}
`;
  assert.deepEqual(registrationProblems(registrationsIn("fixture/Dev.swift", debugAndRelease)), []);
  const twiceInOneBranch = `public class TwiceModule: Module {
  #if DEBUG
  public func definition() -> ModuleDefinition {
    Name("ArdiaTwice")
  }
  #endif
  #if DEBUG
  public func other() -> ModuleDefinition {
    Name("ArdiaTwice")
  }
  #endif
}
`;
  assert.deepEqual(registrationProblems(registrationsIn("fixture/Twice.swift", twiceInOneBranch)), [
    "fixture/Twice.swift TwiceModule registers twice: ArdiaTwice, ArdiaTwice",
  ]);
});

test("no two packages list the same Swift module class, so the generated modules provider can name each one", () => {
  const classes = nativePackages.flatMap((pkg) => {
    const config = JSON.parse(readFileSync(new URL(`${pkg}/expo-module.config.json`, packagesDir), "utf8"));
    return (config.apple?.modules ?? []).map((name) => ({ key: name, where: pkg }));
  });
  assert.deepEqual(duplicates(classes), []);
});
