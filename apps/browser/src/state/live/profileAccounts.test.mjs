import assert from "node:assert/strict";
import { test } from "node:test";
import { docs, failedSaves, heldKeychainReads, heldKeychainWrites, heldSaves, keychainItems, keychainRefusals } from "../../test-native/index.ts";

const legacyAccount = (login) => ({ login, name: null, avatar: null, connectedAt: 1 });
docs.set(
  "live.json",
  JSON.stringify({
    version: 1,
    accounts: {
      github: legacyAccount("LuisUrrutia"),
      notion: legacyAccount("Acme"),
      bitbucket: legacyAccount("acc-1"),
      gdrive: legacyAccount("me@gmail.com"),
      confluence: legacyAccount("conf-1"),
    },
    config: { bitbucketUser: "me@example.com", googleClientId: "client-A", confluenceSite: "https://home.atlassian.net", confluenceEmail: "me@home.com" },
  }),
);
keychainItems.set("github", "personal-token");
keychainItems.set("bitbucket", "bitbucket-token");
keychainItems.set("confluence", "home-confluence-token");
keychainItems.set("gdrive", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 0, client_secret: "secret-A" }));

const { useBrowser } = await import("../browser/store.ts");
const { adoptLegacyAccounts, connectConfluence, connectGithub, connectGoogle, disconnect, forgetMissingProfiles, forgetProfileAccounts, retryOwedLegacyAccounts, SOURCES } = await import("./sources.ts");
const { live, setAccount, setLegacyAccount, updateConfig } = await import("./store.ts");
const { settingsBrowserWindow } = await import("../settings/settingsWindows.ts");

const personal = useBrowser.getState().createProfile({ name: "Personal" });
const work = useBrowser.getState().createProfile({ name: "Work" });

const logins = { "personal-token": "LuisUrrutia", "work-token": "luis-urrutia-flute" };
const tokensAsked = [];
const confluenceAsked = [];
const driveAsked = [];
const google = { refreshes: [], hold: null };
globalThis.fetch = async (url, init) => {
  const auth = init.headers.Authorization;
  if (url.endsWith("/wiki/rest/api/user/current")) return Response.json({ accountId: "conf-2", displayName: "Work" });
  if (url.includes("/wiki/rest/api/content/search")) {
    confluenceAsked.push([new URL(url).host, auth]);
    return Response.json({ results: [] });
  }
  if (url === "https://oauth2.googleapis.com/token") {
    const body = new URLSearchParams(init.body);
    if (body.get("grant_type") === "authorization_code") return Response.json({ access_token: "token-B", refresh_token: "refresh-B", expires_in: 3600 });
    google.refreshes.push(body.get("refresh_token"));
    if (google.hold) await google.hold;
    return Response.json({ access_token: `refreshed-${body.get("refresh_token")}`, expires_in: 3600 });
  }
  if (url.includes("/drive/v3/about")) return Response.json({ user: { displayName: "B", emailAddress: "b@gmail.com" } });
  if (url.includes("/drive/v3/files")) {
    driveAsked.push(auth);
    return Response.json({ files: [] });
  }
  const token = auth.replace("Bearer ", "");
  const body = JSON.parse(init.body);
  if (body.query.includes("viewer") && !body.query.includes("search")) {
    return Response.json({ data: { viewer: { login: logins[token], name: null, avatarUrl: "" } } });
  }
  tokensAsked.push(token);
  return Response.json({ data: { authored: { nodes: [] }, review: { nodes: [] }, direct: { nodes: [] } } });
};

const folderIn = (profileId, kind = "pullRequests", sources = ["github"]) => ({ id: `f-${profileId}`, profileId, kind, sources, filters: { authored: true, reviewRequests: true } });
const until = async (condition) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(condition(), "timed out waiting");
};
const release = (held) => held.queue.splice(0).forEach((land) => land());
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

test("the account saved before profiles had their own moves to every profile, and only a fully copied one loses its old keychain item", async () => {
  keychainRefusals.add(`bitbucket:${work}`);

  await adoptLegacyAccounts([personal, work]);

  assert.equal(live().accounts[personal].github.login, "LuisUrrutia");
  assert.equal(live().accounts[work].github.login, "LuisUrrutia");
  assert.equal(keychainItems.get(`github:${work}`), "personal-token");
  assert.equal(keychainItems.has("github"), false);
  assert.equal(live().accounts[personal].bitbucket.user, "me@example.com");
  assert.equal(keychainItems.get("bitbucket"), "bitbucket-token", "a refused copy keeps the original");
  assert.deepEqual(Object.keys(live().legacyAccounts).sort(), ["bitbucket", "notion"], "an unreadable secret and a refused copy stay pending");
  assert.deepEqual(live().legacyAccounts.bitbucket.owedTo, [work], "only the refused profile is still owed a copy");
  assert.equal(live().accounts[work].confluence.site, "https://home.atlassian.net");
  assert.equal(live().accounts[work].confluence.user, "me@home.com");
  assert.ok(JSON.parse(docs.get("live.json")).accounts[work].github, "saved before the original was deleted");
  assert.equal(JSON.parse(keychainItems.get(`gdrive:${work}`)).client_id, "client-A", "Google tokens keep the client they were issued to");
});

test("a later try copies a pending account only to the profile still owed it, so a disconnect in between stays", async () => {
  keychainRefusals.clear();
  updateConfig({ bitbucketUser: "someone-else@example.com" });
  await disconnect(personal, "bitbucket");

  await adoptLegacyAccounts([personal, work]);

  assert.equal(live().accounts[work].bitbucket.login, "acc-1");
  assert.equal(live().accounts[work].bitbucket.user, "me@example.com");
  assert.equal(live().accounts[work].bitbucket.owedTo, undefined);
  assert.equal(live().accounts[personal].bitbucket, undefined);
  assert.equal(keychainItems.has(`bitbucket:${personal}`), false);
  assert.equal(keychainItems.has("bitbucket"), false);
  assert.deepEqual(Object.keys(live().legacyAccounts), ["notion"]);
});

test("the old keychain item stays until live.json has landed on disk", async () => {
  keychainItems.set("notion", "notion-token");
  heldSaves.on = true;

  const adopting = adoptLegacyAccounts([personal, work]);
  await until(() => heldSaves.queue.length > 0);
  const keptWhileSaving = keychainItems.has("notion");
  heldSaves.on = false;
  release(heldSaves);
  await adopting;

  assert.equal(keptWhileSaving, true);
  assert.equal(keychainItems.has("notion"), false);
  assert.equal(keychainItems.get(`notion:${work}`), "notion-token");
});

test("a profile reconnected to another account fetches with it while the other profile keeps its own", async () => {
  await disconnect(work, "github");
  await connectGithub(work, "work-token");
  tokensAsked.length = 0;

  await SOURCES.github.fetch(folderIn(work));
  await SOURCES.github.fetch(folderIn(personal));

  assert.equal(live().accounts[work].github.login, "luis-urrutia-flute");
  assert.equal(live().accounts[personal].github.login, "LuisUrrutia");
  assert.deepEqual(tokensAsked, ["work-token", "personal-token"]);
});

test("each profile reaches its own Confluence site with its own email and token", async () => {
  await connectConfluence(work, "work.atlassian.net", "me@work.com", "work-confluence-token");

  await SOURCES.confluence.fetch(folderIn(work, "documents", ["confluence"]));
  await SOURCES.confluence.fetch(folderIn(personal, "documents", ["confluence"]));

  const basic = (user, token) => `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;
  assert.deepEqual(confluenceAsked, [
    ["work.atlassian.net", basic("me@work.com", "work-confluence-token")],
    ["home.atlassian.net", basic("me@home.com", "home-confluence-token")],
  ]);
});

test("a Google refresh that lands after the profile reconnected another account keeps the new account", async () => {
  const held = deferred();
  google.hold = held.promise;
  const fetching = SOURCES.gdrive.fetch(folderIn(personal, "documents", ["gdrive"]));
  await until(() => google.refreshes.length > 0);

  await disconnect(personal, "gdrive");
  await connectGoogle(personal, "client-B", "secret-B", "code", "verifier", "http://127.0.0.1/callback");
  google.hold = null;
  held.resolve();
  await fetching;

  assert.equal(JSON.parse(keychainItems.get(`gdrive:${personal}`)).refresh_token, "refresh-B");
  assert.equal(live().accounts[personal].gdrive.login, "b@gmail.com");
  assert.deepEqual(driveAsked, ["Bearer token-B"]);
});

test("a Google refresh that lands after its profile was deleted leaves no keychain item behind", async () => {
  const doomed = useBrowser.getState().createProfile({ name: "Temp" });
  keychainItems.set(`gdrive:${doomed}`, JSON.stringify({ access_token: "old", refresh_token: "r-doomed", expires_at: 0, client_secret: "s", client_id: "c" }));
  setAccount(doomed, "gdrive", legacyAccount("temp@gmail.com"));
  const held = deferred();
  google.hold = held.promise;
  const fetching = SOURCES.gdrive.fetch(folderIn(doomed, "documents", ["gdrive"]));
  await until(() => google.refreshes.includes("r-doomed"));

  useBrowser.getState().deleteProfile(doomed);
  const forgetting = forgetProfileAccounts(doomed);
  google.hold = null;
  held.resolve();

  await assert.rejects(fetching, (error) => error.kind === "notConfigured");
  await forgetting;
  assert.equal(keychainItems.has(`gdrive:${doomed}`), false);
  assert.equal(live().accounts[doomed], undefined);
});

test("a connection that finishes after its profile was deleted leaves no account or keychain item behind", async () => {
  const doomed = useBrowser.getState().createProfile({ name: "Temp" });
  const connecting = connectGithub(doomed, "work-token");
  useBrowser.getState().deleteProfile(doomed);

  await assert.rejects(connecting);

  assert.equal(live().accounts[doomed]?.github, undefined);
  assert.equal(keychainItems.has(`github:${doomed}`), false);
});

test("a profile deleted while its keychain write is in flight leaves no account or keychain item behind", async () => {
  const doomed = useBrowser.getState().createProfile({ name: "Temp" });
  heldKeychainWrites.on = true;
  const connecting = connectGithub(doomed, "work-token");
  await until(() => heldKeychainWrites.queue.length > 0);

  useBrowser.getState().deleteProfile(doomed);
  heldKeychainWrites.on = false;
  release(heldKeychainWrites);
  await connecting;

  assert.equal(live().accounts[doomed]?.github, undefined);
  assert.equal(keychainItems.has(`github:${doomed}`), false);
});

test("a profile with no account of its own reports the source as not connected", async () => {
  await assert.rejects(SOURCES.github.fetch(folderIn("third")), (error) => error.kind === "notConfigured");
});

test("sign-in pages open in a window of the profile being connected, falling back to the frontmost window", () => {
  const personalWindow = useBrowser.getState().createWindow({ profileId: personal });
  const workWindow = useBrowser.getState().createWindow({ profileId: work });

  assert.equal(settingsBrowserWindow(personal), personalWindow);
  assert.equal(settingsBrowserWindow(work), workWindow);
  assert.equal(settingsBrowserWindow("no-windows"), workWindow);
});

test("a pending copy fills a profile whose account lost its keychain item or wasn't saved, and keeps one holding another connection owed", async () => {
  const stale = useBrowser.getState().createProfile({ name: "Stale" });
  const copied = useBrowser.getState().createProfile({ name: "Copied" });
  const fresh = useBrowser.getState().createProfile({ name: "Fresh" });
  setAccount(stale, "notion", legacyAccount("Lost"));
  keychainItems.set(`notion:${copied}`, "legacy-notion-token");
  keychainItems.set(`notion:${fresh}`, "fresh-token");
  keychainItems.set("notion", "legacy-notion-token");
  setLegacyAccount("notion", legacyAccount("Acme"));

  await adoptLegacyAccounts([stale, copied, fresh]);

  assert.equal(keychainItems.get(`notion:${stale}`), "legacy-notion-token");
  assert.equal(live().accounts[stale].notion.login, "Acme");
  assert.equal(live().accounts[copied].notion.login, "Acme");
  assert.equal(keychainItems.get(`notion:${fresh}`), "fresh-token");
  assert.equal(live().accounts[fresh]?.notion, undefined);
  assert.deepEqual(live().legacyAccounts.notion.owedTo, [fresh]);
  assert.equal(keychainItems.get("notion"), "legacy-notion-token");
});

test("a profile deleted while the move reads its keychain item gets no account and keeps no item", async () => {
  const doomed = useBrowser.getState().createProfile({ name: "Temp" });
  keychainItems.set(`notion:${doomed}`, "legacy-notion-token");
  setLegacyAccount("notion", { ...legacyAccount("Acme"), owedTo: [doomed] });
  heldKeychainReads.on = true;

  const adopting = adoptLegacyAccounts([doomed]);
  await until(() => heldKeychainReads.queue.length > 0);
  release(heldKeychainReads);
  await until(() => heldKeychainReads.queue.length > 0);
  useBrowser.getState().deleteProfile(doomed);
  heldKeychainReads.on = false;
  release(heldKeychainReads);
  await adopting;

  assert.equal(live().accounts[doomed]?.notion, undefined);
  assert.equal(keychainItems.has(`notion:${doomed}`), false);
});

test("a deleted profile keeps its accounts until every keychain item is gone, so a later pass can retry", async () => {
  const doomed = useBrowser.getState().createProfile({ name: "Temp" });
  setAccount(doomed, "github", legacyAccount("someone"));
  keychainItems.set(`github:${doomed}`, "doomed-token");
  keychainRefusals.add(`github:${doomed}`);
  useBrowser.getState().deleteProfile(doomed);

  await forgetProfileAccounts(doomed);
  const keptAfterRefusal = live().accounts[doomed]?.github?.login;
  keychainRefusals.clear();
  await forgetProfileAccounts(doomed);

  assert.equal(keptAfterRefusal, "someone");
  assert.equal(keychainItems.has(`github:${doomed}`), false);
  assert.equal(live().accounts[doomed], undefined);
});

test("deleting a profile whose account was never saved still removes its keychain item", async () => {
  const doomed = useBrowser.getState().createProfile({ name: "Temp" });
  keychainItems.set(`github:${doomed}`, "unsaved-token");

  useBrowser.getState().deleteProfile(doomed);
  forgetMissingProfiles([doomed]);
  await until(() => !keychainItems.has(`github:${doomed}`));

  assert.equal(keychainItems.has(`github:${doomed}`), false);
});

const pendingNotion = (owedTo) => {
  keychainItems.set("notion", "legacy-notion-token");
  setLegacyAccount("notion", { ...legacyAccount("Acme"), owedTo });
};

test("disconnecting a profile still owed the old account takes it off the list, so the next try doesn't copy it back", async () => {
  const owed = useBrowser.getState().createProfile({ name: "Owed" });
  pendingNotion([owed]);
  keychainItems.set(`notion:${owed}`, "own-token");
  setAccount(owed, "notion", legacyAccount("Own"));

  await disconnect(owed, "notion");
  await adoptLegacyAccounts([owed]);

  assert.equal(keychainItems.has(`notion:${owed}`), false);
  assert.equal(live().accounts[owed]?.notion, undefined);
});

test("the old account's record survives a save that fails, so the next try still deletes its keychain item", async () => {
  const profile = useBrowser.getState().createProfile({ name: "Saving" });
  pendingNotion([profile]);
  failedSaves.on = true;

  await adoptLegacyAccounts([profile]);
  const kept = live().legacyAccounts.notion?.owedTo;
  failedSaves.on = false;
  await adoptLegacyAccounts([profile]);

  assert.deepEqual(kept, [profile]);
  assert.equal(live().legacyAccounts.notion, undefined);
  assert.equal(keychainItems.has("notion"), false);
});

test("the old account's record stays until its keychain item is really deleted", async () => {
  const profile = useBrowser.getState().createProfile({ name: "Deleting" });
  pendingNotion([profile]);
  keychainRefusals.add("notion");

  await adoptLegacyAccounts([profile]);
  const kept = live().legacyAccounts.notion?.owedTo;
  keychainRefusals.clear();
  await adoptLegacyAccounts([profile]);

  assert.deepEqual(kept, []);
  assert.equal(live().legacyAccounts.notion, undefined);
  assert.equal(keychainItems.has("notion"), false);
});

test("a refused copy is retried in the same session once the keychain takes it", async () => {
  const profile = useBrowser.getState().createProfile({ name: "Retry" });
  pendingNotion([profile]);
  keychainRefusals.add(`notion:${profile}`);
  await adoptLegacyAccounts([profile]);
  keychainRefusals.clear();

  await retryOwedLegacyAccounts();

  assert.equal(keychainItems.get(`notion:${profile}`), "legacy-notion-token");
  assert.equal(live().accounts[profile].notion.login, "Acme");
});

test("a connection finishes only once its account has landed on disk", async () => {
  const profile = useBrowser.getState().createProfile({ name: "Durable" });
  heldSaves.on = true;
  let finished = false;

  const connecting = connectGithub(profile, "work-token").then(() => (finished = true));
  await until(() => heldSaves.queue.length > 0);
  const finishedBeforeSave = finished;
  heldSaves.on = false;
  release(heldSaves);
  await connecting;

  assert.equal(finishedBeforeSave, false);
  assert.equal(JSON.parse(docs.get("live.json")).accounts[profile].github.login, "luis-urrutia-flute");
});
