import assert from "node:assert/strict";
import { test } from "node:test";
import { addressOf, fileUrlOf, launchAddresses } from "../../../../packages/expo-windows/src/launchLinks/addresses.ts";

const plain = (...texts) => ({ arguments: texts.map((text) => ({ text })) });

test("web and file addresses on the command line are opened, switches never are", () => {
  const launch = plain("--log-file=C:\\logs\\a.log", "https://example.com/", "-flag", "/switch", "--self-check", "http://example.org/a?b=c#d", "file:///C:/x.html");
  assert.deepEqual(launchAddresses(launch), ["https://example.com/", "http://example.org/a?b=c#d", "file:///C:/x.html"]);
});

test("a launch with only switches or nothing opens nothing", () => {
  assert.deepEqual(launchAddresses(plain()), []);
  assert.deepEqual(launchAddresses(plain("--self-check", "--log-file=C:\\a b\\log.txt", "----AppNotificationActivated:")), []);
  assert.deepEqual(launchAddresses(null), []);
  assert.deepEqual(launchAddresses({}), []);
});

test("after a bare -- every argument is an address, even one that looks like a switch", () => {
  assert.deepEqual(launchAddresses(plain("--", "-not-a-switch.example.com", "https://example.com/")), ["http://-not-a-switch.example.com", "https://example.com/"]);
});

test("the default browser's --single-argument form opens its whole remainder as one address", () => {
  const launch = { arguments: [{ text: "--profile-directory=Default" }], single: { text: "https://example.com/a b?q=\"x\"" } };
  assert.deepEqual(launchAddresses(launch), ["https://example.com/a%20b?q=\"x\""]);
  assert.deepEqual(launchAddresses({ arguments: [], single: { text: "--looks-like-a-switch" } }), []);
});

test("other schemes are refused, as the running app's relaunch refuses them", () => {
  for (const text of ["javascript:alert(1)", "mailto:a@example.com", "ardia://settings", "data:text/html,hi", "chrome://settings", "localhost:3000", "ftp://example.com/"]) {
    assert.equal(addressOf({ text }), null, text);
  }
});

test("a file that exists opens by its full path, wherever it was named from", () => {
  assert.equal(addressOf({ text: "page.html", file: "C:\\Users\\t3\\My Pages\\page #1.html" }), "file:///C:/Users/t3/My%20Pages/page%20%231.html");
  assert.equal(addressOf({ text: "\\\\server\\share\\a.pdf", file: "\\\\Server\\share\\a.pdf" }), "file://server/share/a.pdf");
});

test("an absolute path opens as a file even when it doesn't exist, as Chromium's fixup does", () => {
  assert.equal(addressOf({ text: "D:/notes/todo.txt" }), "file:///D:/notes/todo.txt");
  assert.equal(fileUrlOf("relative\\path.html"), null);
});

test("a bare host becomes a web address, a bare word or text with spaces does not", () => {
  assert.equal(addressOf({ text: "example.com" }), "http://example.com");
  assert.equal(addressOf({ text: "example.com/path?q=1" }), "http://example.com/path?q=1");
  assert.equal(addressOf({ text: "localhost:8080/x" }), null);
  assert.equal(addressOf({ text: "localhost" }), "http://localhost");
  for (const text of ["hello", "two words.com", "notes\\todo.txt", "", "   "]) assert.equal(addressOf({ text }), null, JSON.stringify(text));
});

test("web addresses keep their scheme and gain the slashes a lax form left out", () => {
  assert.equal(addressOf({ text: "HTTPS://Example.com" }), "https://Example.com");
  assert.equal(addressOf({ text: "http:example.com/x" }), "http://example.com/x");
  assert.equal(addressOf({ text: "https://" }), null);
});
