import assert from "node:assert/strict";
import test from "node:test";
import { connectSources, shellContentSecurityPolicy, shellPolicyDirectives } from "../scripts/shell-csp.mjs";

test("the privileged shell keeps connect-src 'none' because suggestions travel through the native host", () => {
  assert.deepEqual(connectSources(), ["'none'"]);
});

test("the rest of the shell policy keeps its privileged restrictions", () => {
  const directives = shellPolicyDirectives();
  assert.equal(directives.get("DefaultSrc"), "default-src 'none';");
  assert.equal(directives.get("ScriptSrc"), "script-src 'self';");
  assert.equal(directives.get("FrameSrc"), "frame-src 'none';");
  assert.equal(directives.get("ObjectSrc"), "object-src 'none';");
  assert.equal(directives.get("FormAction"), "form-action 'none';");
  assert.equal(directives.get("TrustedTypes"), "trusted-types ardia-symbols;");
  assert.match(shellContentSecurityPolicy(), /require-trusted-types-for 'script';/);
});

test("the policy parser joins concatenated native string literals and rejects a missing policy", () => {
  const source = `class ShellDataSource {
      case Directive::DefaultSrc: return "default-src 'none';";
      case Directive::ConnectSrc:
        return "connect-src https://a.example/x "
               "https://b.example/y/;";
    void StartDataRequest() {}`;
  assert.deepEqual(connectSources(source), ["https://a.example/x", "https://b.example/y/"]);
  assert.throws(() => connectSources("class Other {}"), /not found/);
});
