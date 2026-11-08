import assert from "node:assert/strict";
import { test } from "node:test";
const { unreadInTitle, unreadCount, faviconLooksBadged, originOf } = await import("./unread.ts");

const label = (title) => {
  const u = unreadInTitle(title);
  return u === null ? null : u.kind === "dot" ? "dot" : u.label;
};

test("a parenthesised count at the start of the title is a count", () => {
  assert.equal(label("(3) Home / X"), "3");
  assert.equal(label("(1) Facebook"), "1");
  assert.equal(label("(12) Feed | LinkedIn"), "12");
  assert.equal(label("(2) WhatsApp"), "2");
  assert.equal(label("(4) Discord | #general | Friends"), "4");
  assert.equal(label("(5) Chat | Microsoft Teams"), "5");
  assert.equal(label("(7) Inbox | me@proton.me | Proton Mail"), "7");
  assert.equal(label("[3] Mattermost"), "3");
  assert.equal(label("(99+) Facebook"), "99+");
  assert.equal(label("(20+) Messenger"), "20+");
  assert.equal(label("(250) YouTube"), "99+");
});

test("a short label with a count before the site name is a count", () => {
  assert.equal(label("Inbox (3) - someone@gmail.com - Gmail"), "3");
  assert.equal(label("Inbox (1,234) - someone@gmail.com - Gmail"), "99+");
  assert.equal(label("Chat (2) - Google Chat"), "2");
  assert.equal(label("Messenger (2)"), "2");
  assert.equal(label("Telegram (14)"), "14");
  assert.equal(label("Notifications (6) | GitHub"), "6");
});

test("count phrases read anywhere in the title", () => {
  assert.equal(label("Mail - 4 unread - Outlook"), "4");
  assert.equal(label("Fastmail (2 unread)"), "2");
  assert.equal(label("Team Chat · 3 new messages"), "3");
});

test("unread markers without a number are a dot", () => {
  assert.equal(label("• Discord | #general | Friends"), "dot");
  assert.equal(label("* general - Acme - Slack"), "dot");
  assert.equal(label("! general - Acme - Slack"), "dot");
});

test("zero clears the badge", () => {
  assert.equal(label("(0) Home / X"), null);
  assert.equal(label("Inbox (0) - someone@gmail.com - Gmail"), null);
});

test("ordinary numbers in titles are not counts", () => {
  for (const title of [
    "Inbox - someone@gmail.com - Gmail",
    "Dune (2021) - IMDb",
    "(2024) Year in review",
    "Top 10 Movies of 2024 (Ranked) - Site",
    "The Best Laptops of 2024 (Tested) | Example",
    "iPhone 15 Pro (128GB) - Apple",
    "Python (programming language) - Wikipedia",
    "Episode 3: The Return (Part 2) - Show",
    "What happened in the 2016 US election (2016) and why it matters - Long Read",
    "Chapter 12 - The Book",
    "100 days of code",
    "React 19 is out",
    "Section 4.2 (2) — Docs",
    "*",
    "• 3 things to know",
    "",
  ])
    assert.equal(label(title), null, title);
});

test("API counts cap at 99+ and zero clears", () => {
  assert.deepEqual(unreadCount(5), { kind: "count", label: "5" });
  assert.deepEqual(unreadCount(100), { kind: "count", label: "99+" });
  assert.equal(unreadCount(0), null);
  assert.equal(unreadCount(Number.NaN), null);
});

test("a favicon swapped for a drawn or badge-named icon counts as a badge", () => {
  assert.equal(faviconLooksBadged("https://a.example/favicon.ico", "data:image/png;base64,AAAA"), true);
  assert.equal(faviconLooksBadged("https://a.example/favicon.ico", "https://a.example/favicon-unread.ico"), true);
  assert.equal(faviconLooksBadged("https://ssl.gstatic.com/mail/favicon.ico", "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/unreadcountfavicon/3/5_2x.png"), true);
  assert.equal(faviconLooksBadged("https://a.example/favicon.ico", "https://a.example/favicon.ico"), false);
  assert.equal(faviconLooksBadged("https://github.com/favicon.ico", "https://github.githubassets.com/favicons/favicon-success.svg"), false);
  assert.equal(faviconLooksBadged("data:image/png;base64,AAAA", "data:image/png;base64,BBBB"), false);
  assert.equal(faviconLooksBadged("", "data:image/png;base64,AAAA"), false);
});

test("origins compare scheme, host and port", () => {
  assert.equal(originOf("https://Mail.Google.com/mail/u/0/#inbox"), "https://mail.google.com");
  assert.equal(originOf("http://localhost:8080/x?y"), "http://localhost:8080");
  assert.equal(originOf("about:blank"), "");
});
