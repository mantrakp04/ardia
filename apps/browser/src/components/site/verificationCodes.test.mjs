import assert from "node:assert/strict";
import { test } from "node:test";
import { isVerificationCodeScheme, MAX_VERIFICATION_CODE_URL, offerSurvivesNavigation, parseVerificationCodeSetup, verificationCodeSetupCopy } from "./verificationCodes.ts";

test("a TOTP setup link names its issuer and account, the issuer parameter winning over the label", () => {
  assert.deepEqual(parseVerificationCodeSetup("otpauth://totp/Old%20Name:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example"), {
    issuer: "Example",
    account: "alice@example.com",
  });
  assert.deepEqual(parseVerificationCodeSetup("otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP"), { issuer: "GitHub", account: "octocat" });
  assert.deepEqual(parseVerificationCodeSetup("otpauth://totp/ACME%20Co%3Ajohn.doe%40email.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME+Co"), {
    issuer: "ACME Co",
    account: "john.doe@email.com",
  });
  assert.deepEqual(parseVerificationCodeSetup("otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP"), { issuer: "", account: "alice" });
});

test("HOTP links and Google Authenticator exports are setup links too", () => {
  assert.deepEqual(parseVerificationCodeSetup("otpauth://hotp/Bank:me?secret=JBSWY3DPEHPK3PXP&counter=0"), { issuer: "Bank", account: "me" });
  assert.deepEqual(parseVerificationCodeSetup("otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SBWFsaWNlGgdFeGFtcGxl"), { issuer: "", account: "" });
});

test("anything that can't set up a code is refused", () => {
  for (const url of [
    "otpauth://totp/Example:alice?issuer=Example",
    "otpauth://totp/Example:alice?secret=&issuer=Example",
    "otpauth-migration://offline?data=",
    "otpauth://steam/Example:alice?secret=JBSWY3DPEHPK3PXP",
    "https://example.com/otpauth://totp/a?secret=JBSWY3DPEHPK3PXP",
    "javascript:alert(1)//otpauth://totp/a?secret=JBSWY3DPEHPK3PXP",
    "otpauth://totp/%E0%A4%A?secret=JBSWY3DPEHPK3PXP",
  ]) {
    assert.equal(parseVerificationCodeSetup(url), null, url);
  }
});

test("a setup link longer than 2048 characters is refused", () => {
  const head = "otpauth://totp/Example:alice?secret=";
  const fits = head + "A".repeat(MAX_VERIFICATION_CODE_URL - head.length);
  assert.equal(fits.length, 2048);
  assert.deepEqual(parseVerificationCodeSetup(fits), { issuer: "Example", account: "alice" });
  assert.equal(parseVerificationCodeSetup(fits + "A"), null);
});

test("the prompt names the issuer and account it has, and drops what it doesn't", () => {
  assert.deepEqual(verificationCodeSetupCopy({ issuer: "GitHub", account: "octocat" }), {
    title: "Set up a verification code for GitHub?",
    message: "Passwords can fill the codes for octocat from now on.",
  });
  assert.deepEqual(verificationCodeSetupCopy({ issuer: "", account: "" }), {
    title: "Set up this verification code?",
    message: "Passwords can fill the codes from now on.",
  });
  assert.equal(verificationCodeSetupCopy({ issuer: "x".repeat(200), account: "" }).title.length < 80, true);
  assert.equal(verificationCodeSetupCopy({ issuer: "GitHub", account: "octocat" }, "github.com").message, "From github.com. Passwords can fill the codes for octocat from now on.");
});

test("invisible and direction-changing characters can't disguise the issuer, and unencoded links are refused", () => {
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
