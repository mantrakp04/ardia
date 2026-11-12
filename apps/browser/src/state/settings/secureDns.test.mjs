import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const { secureDnsEngine } = await import("../../test-native/secureDns.ts");
const { checkCustomSecureDns, chooseSecureDns, saveCustomSecureDns, secureDnsChoice, secureDnsEditableTemplates, secureDnsHosts } = await import("./secureDns.ts");
const { secureDnsSetting } = await import("../telemetry/settingsSnapshot.ts");

const providers = secureDnsEngine.state().providers;
const cloudflare = providers[0];

const at = (prefMode, prefTemplates = "") => ({ prefMode, prefTemplates, providers });

test("the choice follows Chrome's prefs: a secure address names its built-in provider or stays custom, and automatic with an address falls back", () => {
  assert.deepEqual(secureDnsChoice(at("automatic")), { kind: "network" });
  assert.deepEqual(secureDnsChoice(at("automatic", "https://dns.example.com/dns-query")), { kind: "custom", templates: "https://dns.example.com/dns-query", fallback: true });
  assert.deepEqual(secureDnsChoice(at("off")), { kind: "off" });
  assert.deepEqual(secureDnsChoice(at("")), { kind: "off" });
  assert.deepEqual(secureDnsChoice(at("secure", cloudflare.templates)), { kind: "provider", provider: cloudflare });
  assert.deepEqual(secureDnsChoice(at("secure", "https://dns.example.com/dns-query")), { kind: "custom", templates: "https://dns.example.com/dns-query", fallback: false });
});

test("a custom provider shows its hosts, from plain templates or Chrome's JSON form", () => {
  assert.equal(secureDnsHosts("https://DNS.Example.com/dns-query{?dns} https://dns.example.com/other https://doh.example.net/q"), "dns.example.com, doh.example.net");
  assert.equal(secureDnsHosts(JSON.stringify({ servers: [{ template: "https://a.example/dns-query", endpoints: [] }, { template: "https://b.example/q" }] })), "a.example, b.example");
});

test("editing a custom provider shows Chrome's stored addresses on one line, keeping its JSON form intact", () => {
  assert.equal(secureDnsEditableTemplates("https://a.example/dns-query\nhttps://b.example/q"), "https://a.example/dns-query https://b.example/q");
  const json = { servers: [{ template: "https://a.example/a  b", endpoints: [{ ips: ["192.0.2.1"] }] }] };
  assert.equal(secureDnsEditableTemplates(JSON.stringify(json, null, 2)), JSON.stringify(json));
});

test("picking a choice writes what Chrome's own settings write", async () => {
  secureDnsEngine.reset();
  assert.equal((await chooseSecureDns({ kind: "provider", provider: cloudflare })).prefMode, "secure");
  assert.deepEqual(secureDnsEngine.writes.at(-1), { mode: "secure", templates: cloudflare.templates });
  await chooseSecureDns({ kind: "off" });
  assert.deepEqual(secureDnsEngine.writes.at(-1), { mode: "off", templates: "" });
  await chooseSecureDns({ kind: "network" });
  assert.deepEqual(secureDnsEngine.writes.at(-1), { mode: "automatic", templates: "" });
  await saveCustomSecureDns("  https://dns.example.com/dns-query  ");
  assert.deepEqual(secureDnsEngine.writes.at(-1), { mode: "secure", templates: "https://dns.example.com/dns-query" });
});

test("a policy or a managed Mac keeps the setting as it is", async () => {
  for (const lock of [{ policy: true }, { override: "managed" }]) {
    secureDnsEngine.reset();
    Object.assign(secureDnsEngine, lock);
    await assert.rejects(chooseSecureDns({ kind: "off" }));
    assert.equal(secureDnsEngine.mode, "automatic");
    assert.deepEqual(secureDnsEngine.writes, []);
  }
});

test("a custom address is checked before it's saved", async () => {
  secureDnsEngine.reset();
  assert.equal(await checkCustomSecureDns("dns.example.com"), "invalid");
  assert.equal(await checkCustomSecureDns("https://dns.example.com/dns-query"), "ok");
  secureDnsEngine.answers = false;
  assert.equal(await checkCustomSecureDns("https://dns.example.com/dns-query"), "unverified");
  assert.deepEqual(secureDnsEngine.writes, []);
});

test("the daily snapshot names the mode and the kind of provider, never an address", () => {
  const base = { prefTemplates: "", effectiveMode: "automatic", effectiveTemplates: "", policy: false, override: "none", providers };
  assert.deepEqual(secureDnsSetting(null), {});
  assert.deepEqual(secureDnsSetting({ ...base, prefMode: "automatic" }), {
    setting_secure_dns_mode: "automatic",
    default_secure_dns_mode: "automatic",
    setting_secure_dns_provider: "network",
    secure_dns_effective_mode: "automatic",
    secure_dns_override: "none",
  });
  assert.equal(secureDnsSetting({ ...base, prefMode: "secure", prefTemplates: cloudflare.templates }).setting_secure_dns_provider, "Cloudflare");
  const custom = secureDnsSetting({ ...base, prefMode: "secure", prefTemplates: "https://dns.example.com/dns-query" });
  assert.equal(custom.setting_secure_dns_provider, "custom");
  assert.ok(Object.values(custom).every((v) => !v.includes("example")));
  const odd = [{ ...cloudflare, id: "SomeoneNew" }];
  assert.equal(secureDnsSetting({ ...base, prefMode: "secure", prefTemplates: cloudflare.templates, providers: odd }).setting_secure_dns_provider, "builtIn");
  assert.equal(secureDnsSetting({ ...base, prefMode: "surprise" }).setting_secure_dns_mode, "off");
  const managed = secureDnsSetting({ ...base, prefMode: "secure", prefTemplates: cloudflare.templates, effectiveMode: "off", override: "managed" });
  assert.deepEqual([managed.setting_secure_dns_mode, managed.secure_dns_effective_mode, managed.secure_dns_override], ["secure", "off", "managed"]);
  assert.equal(secureDnsSetting({ ...base, prefMode: "automatic", policy: true }).secure_dns_override, "policy");
});
