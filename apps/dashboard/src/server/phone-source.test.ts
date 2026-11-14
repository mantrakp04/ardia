import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_SOURCE, PHONE_APP_LIBS, PHONE_APP_SOURCE, PHONE_APP_SOURCES } from "./sql.ts";
import { PHONE_LIB, PHONE_SERVICE } from "../../../phone/src/lib/telemetrySchema.ts";

test("phone events have their own source and lib, so no Mac section counts them", () => {
  assert.deepEqual(PHONE_APP_SOURCES, [PHONE_SERVICE]);
  assert.deepEqual(PHONE_APP_LIBS, [PHONE_LIB]);
  assert.ok(!APP_SOURCE.includes(PHONE_SERVICE));
  assert.ok(!APP_SOURCE.includes(PHONE_LIB));
  assert.ok(PHONE_APP_SOURCE.includes(`'${PHONE_SERVICE}'`) && PHONE_APP_SOURCE.includes(`'${PHONE_LIB}'`));
});
