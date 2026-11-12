import assert from "node:assert/strict";
import { test } from "node:test";
const { unreadInTitle, unreadCount, titleWithoutUnread, faviconLooksBadged, faviconIsOrdinary, originOf, hostOfOrigin } = await import("./unread.ts");

const label = (title, host = "") => {
  const u = unreadInTitle(title, host);
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

test("a mailbox-like label or the site's own name with a count is a count", () => {
  assert.equal(label("Inbox (3) - someone@gmail.com - Gmail", "mail.google.com"), "3");
  assert.equal(label("Inbox (1,234) - someone@gmail.com - Gmail", "mail.google.com"), "99+");
  assert.equal(label("Chat (2) - Google Chat", "chat.google.com"), "2");
  assert.equal(label("Messenger (2)", "www.messenger.com"), "2");
  assert.equal(label("Telegram (14)", "web.telegram.org"), "14");
  assert.equal(label("Notifications (6) | GitHub", "github.com"), "6");
});

test("count phrases read anywhere in the title", () => {
  assert.equal(label("Mail - 4 unread - Outlook"), "4");
  assert.equal(label("Fastmail (2 unread)"), "2");
  assert.equal(label("Team Chat · 3 new messages"), "3");
});

test("Discord's bullet is a dot anywhere, Slack's asterisk only on Slack", () => {
  assert.equal(label("• Discord | #general | Friends", "discord.com"), "dot");
  assert.equal(label("* general (Channel) - Acme - Slack", "app.slack.com"), "dot");
  assert.equal(label("* Untitled - Figma", "www.figma.com"), null);
  assert.equal(label("* notes.txt - Editor"), null);
  assert.equal(label("! general - Acme - Slack", "app.slack.com"), null);
  assert.equal(label("● main.ts - Visual Studio Code", "vscode.dev"), null);
});

test("zero clears the badge", () => {
  assert.equal(label("(0) Home / X"), null);
  assert.equal(label("Inbox (0) - someone@gmail.com - Gmail", "mail.google.com"), null);
});

test("ordinary numbers in titles are not counts", () => {
  for (const title of [
    "Inbox - someone@gmail.com - Gmail",
    "Dune (2021) - IMDb",
    "Apollo (13) - News",
    "Rocky (2) - Movies",
    "(2024) Year in review",
    "2024 unread messages from the archive",
    "2,024 unread messages from the archive",
    "Top 10 Movies of 2024 (Ranked) - Site",
    "The Best Laptops of 2024 (Tested) | Example",
    "iPhone 15 Pro (128GB) - Apple",
    "Python (programming language) - Wikipedia",
    "Episode 3: The Return (Part 2) - Show",
    "Chapter 12 - The Book",
    "100 days of code",
    "React 19 is out",
    "Section 4.2 (2) — Docs",
    "*",
    "• 3 things to know",
    "",
  ])
    assert.equal(label(title, "news.example.com"), null, title);
});

test("API counts cap at 99+ and zero clears", () => {
  assert.deepEqual(unreadCount(5), { kind: "count", label: "5" });
  assert.deepEqual(unreadCount(100), { kind: "count", label: "99+" });
  assert.equal(unreadCount(0), null);
  assert.equal(unreadCount(Number.NaN), null);
});

test("only a badge-named icon file counts, never a drawn or animated data: icon or a host or folder name", () => {
  const home = "https://a.example/favicon.ico";
  assert.equal(faviconLooksBadged(home, "https://a.example/favicon-unread.ico"), true);
  assert.equal(faviconLooksBadged(home, "https://a.example/img/favicon_notification.png?v=2"), true);
  assert.equal(faviconLooksBadged(home, "https://a.example/icons/dot-32.png"), true);
  assert.equal(faviconLooksBadged(home, "data:image/png;base64,AAAA"), false);
  assert.equal(faviconLooksBadged(home, "data:image/gif;base64,R0lGOD"), false);
  assert.equal(faviconLooksBadged(home, "https://account.example/favicon.ico"), false);
  assert.equal(faviconLooksBadged(home, "https://a.example/unread/favicon.ico"), false);
  assert.equal(faviconLooksBadged(home, "https://a.example/discount.png"), false);
  assert.equal(faviconLooksBadged(home, home), false);
  assert.equal(faviconLooksBadged(home, "https://github.githubassets.com/favicons/favicon-success.svg"), false);
  assert.equal(faviconLooksBadged("", "https://a.example/favicon-unread.ico"), false);
  assert.equal(faviconIsOrdinary("https://a.example/favicon.ico"), true);
  assert.equal(faviconIsOrdinary("https://a.example/favicon-unread.ico"), false);
  assert.equal(faviconIsOrdinary("data:image/png;base64,AAAA"), false);
});

test("origins compare scheme, host and port", () => {
  assert.equal(originOf("https://Mail.Google.com/mail/u/0/#inbox"), "https://mail.google.com");
  assert.equal(originOf("http://localhost:8080/x?y"), "http://localhost:8080");
  assert.equal(originOf("about:blank"), "");
  assert.equal(hostOfOrigin("https://app.slack.com"), "app.slack.com");
  assert.equal(hostOfOrigin("http://127.0.0.1:8080"), "127.0.0.1");
});

test("a count past 99 reads 99+, and a page's own plus stays", () => {
  assert.deepEqual(unreadCount(99), { kind: "count", label: "99" });
  assert.deepEqual(unreadCount(120), { kind: "count", label: "99+" });
  assert.deepEqual(unreadCount(20, true), { kind: "count", label: "20+" });
  assert.equal(label("(120) Notifications / LinkedIn"), "99+");
  assert.equal(label("(1,204) Inbox"), "99+");
});

test("the title drops its leading count when the badge shows the same count", () => {
  const strip = (title) => titleWithoutUnread(title, unreadInTitle(title));
  assert.equal(strip("(3) Home / X"), "Home / X");
  assert.equal(strip("[3] Mattermost"), "Mattermost");
  assert.equal(strip("(120) Notifications / LinkedIn"), "Notifications / LinkedIn");
  assert.equal(strip("(99+) Facebook"), "Facebook");
  assert.equal(strip("(20+) Messenger"), "Messenger");
  assert.equal(strip("(1,204) Inbox"), "Inbox");
  assert.equal(strip("• Discord | #general"), "Discord | #general");
});

test("the title keeps its text when the badge says something else, or nothing", () => {
  assert.equal(titleWithoutUnread("(3) Home / X", null), "(3) Home / X");
  assert.equal(titleWithoutUnread("(3) Home / X", unreadCount(5)), "(3) Home / X");
  assert.equal(titleWithoutUnread("(3) Home / X", { kind: "dot" }), "(3) Home / X");
  assert.equal(titleWithoutUnread("• Discord", unreadCount(2)), "• Discord");
  assert.equal(titleWithoutUnread("Inbox (3) - me@mail.example - Mail", unreadCount(3)), "Inbox (3) - me@mail.example - Mail");
  assert.equal(titleWithoutUnread("(2021) Dune", unreadCount(2021)), "(2021) Dune");
  assert.equal(titleWithoutUnread("(3)", unreadCount(3)), "(3)");
  assert.equal(titleWithoutUnread("Home / X", unreadCount(3)), "Home / X");
});
