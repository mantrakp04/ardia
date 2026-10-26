import assert from "node:assert/strict";
import { test } from "node:test";
import { docs, keychainItems, keychainRefusals } from "../../test-native/index.ts";

const legacyAccount = (login) => ({ login, name: null, avatar: null, connectedAt: 1 });
docs.set(
  "live.json",
  JSON.stringify({
    version: 1,
    accounts: { github: legacyAccount("LuisUrrutia"), notion: legacyAccount("Acme"), bitbucket: legacyAccount("acc-1"), gdrive: legacyAccount("me@gmail.com") },
    config: { bitbucketUser: "me@example.com", googleClientId: "client-A" },
  }),
);
keychainItems.set("github", "personal-token");
keychainItems.set("bitbucket", "bitbucket-token");
keychainItems.set("gdrive", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 0, client_secret: "secret-A" }));

const { useBrowser } = await import("../browser/store.ts");
const { adoptLegacyAccounts, connectGithub, disconnect, SOURCES } = await import("./sources.ts");
const { live, updateConfig } = await import("./store.ts");

const personal = useBrowser.getState().createProfile({ name: "Personal" });
const work = useBrowser.getState().createProfile({ name: "Work" });

const logins = { "personal-token": "LuisUrrutia", "work-token": "luis-urrutia-flute" };
const tokensAsked = [];
globalThis.fetch = async (_url, init) => {
  const token = init.headers.Authorization.replace("Bearer ", "");
  const body = JSON.parse(init.body);
  if (body.query.includes("viewer") && !body.query.includes("search")) {
    return Response.json({ data: { viewer: { login: logins[token], name: null, avatarUrl: "" } } });
  }
  tokensAsked.push(token);
  return Response.json({ data: { authored: { nodes: [] }, review: { nodes: [] }, direct: { nodes: [] } } });
};

const folderIn = (profileId) => ({ id: `f-${profileId}`, profileId, kind: "pullRequests", sources: ["github"], filters: { authored: true, reviewRequests: true } });

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
  assert.ok(JSON.parse(docs.get("live.json")).accounts[work].github, "saved before the original was deleted");
  assert.equal(JSON.parse(keychainItems.get(`gdrive:${work}`)).client_id, "client-A", "Google tokens keep the client they were issued to");
});

test("a pending account finishes moving on a later try, with the sign-in details it was saved with", async () => {
  keychainRefusals.clear();
  updateConfig({ bitbucketUser: "someone-else@example.com" });

  await adoptLegacyAccounts([personal, work]);

  assert.equal(live().accounts[work].bitbucket.login, "acc-1");
  assert.equal(live().accounts[work].bitbucket.user, "me@example.com");
  assert.equal(keychainItems.has("bitbucket"), false);
  assert.deepEqual(Object.keys(live().legacyAccounts), ["notion"]);
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

test("a connection that finishes after its profile was deleted leaves no account or keychain item behind", async () => {
  const doomed = useBrowser.getState().createProfile({ name: "Temp" });
  const connecting = connectGithub(doomed, "work-token");
  useBrowser.getState().deleteProfile(doomed);

  await assert.rejects(connecting);

  assert.equal(live().accounts[doomed]?.github, undefined);
  assert.equal(keychainItems.has(`github:${doomed}`), false);
});

test("a profile with no account of its own reports the source as not connected", async () => {
  await assert.rejects(SOURCES.github.fetch(folderIn("third")), (error) => error.kind === "notConfigured");
});
