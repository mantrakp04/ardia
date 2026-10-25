import assert from "node:assert/strict";
import { test } from "node:test";
import { greetingFor, hostOf, recentSites, siteName, suggestedForNow } from "./ntpSuggestions.ts";
import { fileUri, pathFromPicked } from "./fileUri.ts";

const at = (day, hour) => new Date(2026, 9, day, hour, 0).getTime();
const page = (url, visitTimes, extra = {}) => ({ url, title: url, favicon: null, visits: visitTimes.length, lastVisit: Math.max(...visitTimes), visitTimes, ...extra });

test("the greeting follows the time of day and uses the first name", () => {
  assert.equal(greetingFor(new Date(2026, 9, 24, 8), "Ada Lovelace"), "Good morning, Ada");
  assert.equal(greetingFor(new Date(2026, 9, 24, 14), "Ada"), "Good afternoon, Ada");
  assert.equal(greetingFor(new Date(2026, 9, 24, 20), ""), "Good evening");
  assert.equal(greetingFor(new Date(2026, 9, 24, 2), "Ada"), "Good evening, Ada");
});

test("suggestions favour sites visited around this hour on the same kind of day", () => {
  const now = new Date(2026, 9, 23, 9, 0);
  const pages = [
    page("https://mail.google.com/mail/u/0/", [at(22, 9), at(21, 9), at(20, 8)]),
    page("https://www.netflix.com/browse", [at(22, 22), at(21, 23), at(20, 22), at(19, 22)]),
    page("https://github.com/example", [at(22, 10)]),
  ];
  const hosts = suggestedForNow(pages, now).map((s) => s.host);
  assert.deepEqual(hosts, ["mail.google.com", "github.com"]);
  assert.deepEqual(suggestedForNow(pages, new Date(2026, 9, 23, 22, 0)).map((s) => s.host), ["netflix.com"]);
});

test("a site's pages are pooled and it suggests the page visited most", () => {
  const now = new Date(2026, 9, 23, 9, 0);
  const pages = [
    page("https://www.youtube.com/watch?v=a", [at(22, 9)]),
    page("https://www.youtube.com/", [at(21, 9), at(20, 9), at(19, 9)]),
  ];
  const [yt] = suggestedForNow(pages, now);
  assert.equal(yt.host, "youtube.com");
  assert.equal(yt.url, "https://www.youtube.com/");
  assert.equal(suggestedForNow(pages, now, new Set(["youtube.com"])).length, 0, "skipped hosts stay out");
});

test("recent sites are distinct hosts, newest first", () => {
  const pages = [
    page("https://a.example/1", [at(20, 9)]),
    page("https://b.example/", [at(22, 9)]),
    page("https://a.example/2", [at(23, 9)]),
  ];
  assert.deepEqual(recentSites(pages).map((s) => s.host), ["a.example", "b.example"]);
});

test("the greeting uses a name only when asked, and never reads the system name otherwise", async () => {
  const { greetingName } = await import("./ntpSuggestions.ts");
  let asked = 0;
  const system = () => (asked++, "Sam Rivera");
  assert.equal(greetingName(false, "", system), "");
  assert.equal(asked, 0);
  assert.equal(greetingName(true, "  Alex ", system), "Alex");
  assert.equal(greetingName(true, "", system), "Sam Rivera");
});

test("a private window's new tab page shows no history, and the switch turns it off everywhere", async () => {
  const { homeHistory } = await import("./ntpSuggestions.ts");
  const history = [{ url: "https://a.example/", visits: 9 }];
  assert.deepEqual(homeHistory(history, { enabled: true, incognito: true }), []);
  assert.deepEqual(homeHistory(history, { enabled: false, incognito: false }), []);
  assert.deepEqual(homeHistory(history, { enabled: true, incognito: false }), history);
});

test("with nothing to show, the history is the same empty list every time, so a store selector stays stable", async () => {
  const { homeHistory } = await import("./ntpSuggestions.ts");
  assert.equal(homeHistory(undefined, { enabled: true, incognito: false }), homeHistory([1], { enabled: false, incognito: false }));
});

test("a site's key is the URL's hostname, without www, credentials or a port", () => {
  assert.equal(hostOf("https://www.Example.com/a?b#c"), "example.com");
  assert.equal(hostOf("https://user:secret@mail.example.com:8443/inbox"), "mail.example.com");
  assert.equal(hostOf("http://[::1]:3000/"), "[::1]");
  assert.equal(hostOf("file:///Users/someone/notes.html"), "");
  assert.equal(hostOf("not a url"), "");
});

test("a tile is named after the registrable domain, also under two-part suffixes", () => {
  assert.equal(siteName("news.bbc.co.uk"), "Bbc");
  assert.equal(siteName("www.abc.net.au"), "Abc");
  assert.equal(siteName("mail.google.com"), "Google");
  assert.equal(siteName("myjoyonline.com.gh"), "Myjoyonline");
  assert.equal(siteName("192.168.1.1"), "192.168.1.1");
  assert.equal(siteName("[::1]"), "[::1]");
});

test("a picked image's file URL is stored as a path, and the path loads back with # and ? escaped", () => {
  assert.equal(pathFromPicked("file:///Users/someone/Pictures/Photo%20%231.jpg"), "/Users/someone/Pictures/Photo #1.jpg");
  assert.equal(pathFromPicked("/Users/someone/Pictures/a.png"), "/Users/someone/Pictures/a.png");
  const uri = fileUri("/Users/someone/Pictures/Photo #1?.jpg");
  assert.equal(uri, "file:///Users/someone/Pictures/Photo%20%231%3F.jpg");
  assert.equal(pathFromPicked(uri), "/Users/someone/Pictures/Photo #1?.jpg");
});

test("suggestions re-rank as the hour changes", () => {
  const pages = [page("https://morning.example/", [at(22, 9), at(21, 9)]), page("https://evening.example/", [at(22, 21), at(21, 21)])];
  assert.deepEqual(suggestedForNow(pages, new Date(2026, 9, 23, 9)).map((s) => s.host), ["morning.example"]);
  assert.deepEqual(suggestedForNow(pages, new Date(2026, 9, 23, 21)).map((s) => s.host), ["evening.example"]);
});
