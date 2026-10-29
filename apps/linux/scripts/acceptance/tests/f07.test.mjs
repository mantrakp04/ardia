import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expectCode } from "../scenarios/f07-passwords-autofill.mjs";
import { fixtureSecret } from "../lib/fixtureSecrets.mjs";

describe("F07 scenario helpers", () => {
  it("never puts a reply body in a refusal failure", async () => {
    const secret = fixtureSecret("pw-");
    await assert.rejects(expectCode(Promise.resolve({ ok: true, value: { password: secret } }), "ERR_REAUTH_UNAVAILABLE", "reveal"), (error) => {
      assert.equal(error.message.includes(secret), false, error.message);
      assert.match(error.message, /reveal: expected ERR_REAUTH_UNAVAILABLE, got success/);
      return true;
    });
    await assert.rejects(expectCode(Promise.resolve({ ok: false, code: "ERR_ENGINE", message: `echo ${secret}` }), "ERR_SECRET_ROUTE", "save"), (error) => {
      assert.equal(error.message.includes(secret), false, error.message);
      assert.match(error.message, /save: expected ERR_SECRET_ROUTE, got ERR_ENGINE/);
      return true;
    });
    assert.deepEqual(await expectCode(Promise.resolve({ ok: false, code: "ERR_SECRET_ROUTE", message: "x" }), "ERR_SECRET_ROUTE", "save"), { code: "ERR_SECRET_ROUTE" });
  });
});
