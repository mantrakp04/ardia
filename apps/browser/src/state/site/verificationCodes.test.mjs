import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isVerificationCodeScheme,
  MAX_VERIFICATION_CODE_URL,
  offerSurvivesNavigation,
  parseVerificationCodeSetup,
  verificationCodeSetupCopy,
} from "./verificationCodes.ts";

test("TOTP and HOTP setup URLs parse the issuer and account", () => {
  assert.deepEqual(parseVerificationCodeSetup("otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"), {
    issuer: "GitHub",
    account: "alice",
  });
  assert.deepEqual(parseVerificationCodeSetup("otpauth://totp/Acme%20Corp:alice%40example.com?secret=JBSWY3DPEHPK3PXP"), {
    issuer: "Acme Corp",
    account: "alice@example.com",
  });
  assert.deepEqual(parseVerificationCodeSetup("otpauth://hotp/alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Fastmail+Inc&counter=1"), {
    issuer: "Fastmail Inc",
    account: "alice@example.com",
  });
  assert.deepEqual(parseVerificationCodeSetup("otpauth://totp/?SECRET=JBSWY3DPEHPK3PXP"), { issuer: "", account: "" });
});

test("migration URLs with data are accepted without exposing opaque batch contents", () => {
  assert.deepEqual(parseVerificationCodeSetup("otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGEV4YW1wbGU6YWxpY2VAZ29vZ2xlLmNvbRoHRXhhbXBsZTAC"), {
    issuer: "",
    account: "",
  });
  assert.equal(parseVerificationCodeSetup("otpauth-migration://offline?data="), null);
  assert.equal(parseVerificationCodeSetup("otpauth-migration://online?data=abc"), null);
});

test("non-setup URLs, missing secrets, bad encodings and oversized payloads are rejected", () => {
  assert.equal(parseVerificationCodeSetup("https://example.com/otpauth://totp/x?secret=AB"), null);
  assert.equal(parseVerificationCodeSetup("javascript:alert(1)"), null);
  assert.equal(parseVerificationCodeSetup("otpauth://totp/GitHub:alice"), null);
  assert.equal(parseVerificationCodeSetup("otpauth://totp/GitHub:alice?secret=%20"), null);
  assert.equal(parseVerificationCodeSetup("otpauth://totp/%E0%A4%A?secret=JBSWY3DPEHPK3PXP"), null);
  assert.equal(parseVerificationCodeSetup("otpauth://steam/alice?secret=JBSWY3DPEHPK3PXP"), null);
  const long = `otpauth://totp/x?secret=${"A".repeat(MAX_VERIFICATION_CODE_URL)}`;
  assert.equal(parseVerificationCodeSetup(long), null);
});

test("prompt copy adapts to whether the code names an issuer, an account, or neither", () => {
  assert.deepEqual(verificationCodeSetupCopy({ issuer: "GitHub", account: "alice@example.com" }, "github.com"), {
    title: "Set up a verification code for GitHub?",
    message: "From github.com. Passwords can fill the codes for alice@example.com from now on.",
  });
  assert.deepEqual(verificationCodeSetupCopy({ issuer: "GitHub", account: "" }), {
    title: "Set up a verification code for GitHub?",
    message: "Passwords can fill the codes from now on.",
  });
  assert.deepEqual(verificationCodeSetupCopy({ issuer: "", account: "alice" }), {
    title: "Set up this verification code?",
    message: "Passwords can fill the codes for alice from now on.",
  });
  assert.deepEqual(verificationCodeSetupCopy({ issuer: "", account: "" }), {
    title: "Set up this verification code?",
    message: "Passwords can fill the codes from now on.",
  });
  const longIssuer = "A".repeat(60);
  const copy = verificationCodeSetupCopy({ issuer: longIssuer, account: "B".repeat(90) }, "C".repeat(90));
  assert.ok(copy.title.length < 80);
  assert.ok(copy.message.length < 200);
});

test("control and bidi characters in labels are stripped and unencoded spaces are rejected", () => {
  assert.deepEqual(parseVerificationCodeSetup("otpauth://totp/x?secret=AB&issuer=Goo%E2%80%8Bgle%E2%80%AE"), { issuer: "Google", account: "x" });
  assert.equal(parseVerificationCodeSetup("otpauth://totp/My Bank:me?secret=AB"), null);
});

test("otpauth links opening the Passwords app read as verification codes", () => {
  assert.equal(isVerificationCodeScheme("otpauth"), true);
  assert.equal(isVerificationCodeScheme("otpauth-migration"), true);
  assert.equal(isVerificationCodeScheme("otpauthx"), false);
  assert.equal(isVerificationCodeScheme("mailto"), false);
});

test("an offer that arrives before its own navigation is reported survives it, and leaving the site drops it", () => {
  const offer = { issuer: "Example", account: "me", url: "otpauth://totp/Example:me?secret=JBSWY3DPEHPK3PXP", origin: "https://example.com" };
  assert.equal(offerSurvivesNavigation(offer, "https://example.com/settings/2fa"), offer);
  assert.equal(offerSurvivesNavigation(offer, "https://example.com:8443/2fa"), null);
  assert.equal(offerSurvivesNavigation(offer, "https://evil.example/"), null);
  assert.equal(offerSurvivesNavigation({ ...offer, origin: "" }, "https://example.com/"), null);
  assert.equal(offerSurvivesNavigation(null, "https://example.com/"), null);
  assert.equal(offerSurvivesNavigation(offer, "not a url"), null);
});
