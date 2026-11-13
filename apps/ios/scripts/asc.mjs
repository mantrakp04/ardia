#!/usr/bin/env node
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const HELP = `App Store Connect, for the iPhone app's TestFlight builds.

  node apps/ios/scripts/asc.mjs status
  node apps/ios/scripts/asc.mjs builds [--build <number>]
  node apps/ios/scripts/asc.mjs next-build
  node apps/ios/scripts/asc.mjs wait --build <number> [--timeout <seconds>]
  node apps/ios/scripts/asc.mjs certificates --save <file>
  node apps/ios/scripts/asc.mjs certificates --new-since <file>
  node apps/ios/scripts/asc.mjs certificates --create <request.csr> --out <file.cer>
  node apps/ios/scripts/asc.mjs public-link --build <number> [--what-to-test <file>] [--privacy-policy <url>]
  node apps/ios/scripts/asc.mjs add-tester --email <address> [--group <name>]
  node apps/ios/scripts/asc.mjs expire --build <number>

Reads the API key from ASC_KEY (path to AuthKey_<id>.p8), ASC_KEY_ID and ASC_ISSUER.
status lists what the key can see: the app record, the App IDs and their capabilities,
registered devices, certificates, profiles, builds and tester groups. A section the key
has no access to prints "forbidden". next-build prints the build number after the highest
one uploaded. wait blocks until a build finishes processing, and stops with Apple's reasons
when the delivery was refused. certificates --save records
the team's certificate ids; --new-since fails when a development certificate was made since
then, which means the archive didn't sign with the stored one. --create makes a development
certificate from a signing request and writes it to --out. public-link puts a build in the
external tester group (made with a public link if it doesn't exist), sets its What to Test
text, submits it for Beta App Review and prints the link. add-tester invites an email address
to an external tester group (Public Testers unless --group names another); TestFlight emails
the invite once the group has an approved build. expire ends testing of an older build for
good: nobody can install it again and Apple can't undo it. It refuses the newest build.`;

const BUNDLE_PREFIX = "com.ardia.browser.ios";
const DEVELOPMENT_CERTIFICATES = new Set(["DEVELOPMENT", "IOS_DEVELOPMENT"]);
const PUBLIC_GROUP = "Public Testers";
const API = "https://api.appstoreconnect.apple.com";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function token() {
  const keyPath = process.env.ASC_KEY;
  const keyId = process.env.ASC_KEY_ID;
  const issuer = process.env.ASC_ISSUER;
  if (!keyPath || !keyId || !issuer) {
    console.error("asc: set ASC_KEY, ASC_KEY_ID and ASC_ISSUER");
    process.exit(64);
  }
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const body = base64url(JSON.stringify({ iss: issuer, iat: now, exp: now + 900, aud: "appstoreconnect-v1" }));
  const key = createPrivateKey(readFileSync(keyPath));
  const signature = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${signature.toString("base64url")}`;
}

class ApiError extends Error {
  constructor(status, detail) {
    super(`${status} ${detail}`);
    this.status = status;
  }
}

let bearer;

async function fail(response) {
  const text = await response.text();
  let detail = text.slice(0, 200);
  try {
    detail = JSON.parse(text).errors.map((error) => error.detail ?? error.title).join("; ");
  } catch {}
  throw new ApiError(response.status, detail);
}

async function send(method, path, body) {
  bearer ??= token();
  const response = await fetch(new URL(path, API), {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) await fail(response);
  return response.status === 204 ? null : (await response.json()).data;
}

const post = (path, body) => send("POST", path, body);
const patch = (path, body) => send("PATCH", path, body);

async function get(path, params = {}) {
  bearer ??= token();
  const url = new URL(path, API);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const rows = [];
  const included = [];
  let next = url.toString();
  while (next) {
    const response = await fetch(next, { headers: { Authorization: `Bearer ${bearer}` } });
    if (!response.ok) await fail(response);
    const page = await response.json();
    rows.push(...(Array.isArray(page.data) ? page.data : [page.data]));
    included.push(...(page.included ?? []));
    next = page.links?.next ?? null;
  }
  return { rows, included };
}

async function section(title, read) {
  console.log(`\n## ${title}`);
  try {
    await read();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    console.log(error.status === 403 ? `forbidden: ${error.message}` : `error: ${error.message}`);
  }
}

function day(value) {
  return value ? value.slice(0, 10) : "?";
}

async function listApps() {
  const { rows } = await get("/v1/apps", { "fields[apps]": "name,bundleId", limit: "200" });
  return rows;
}

async function findApp() {
  return (await listApps()).find((row) => row.attributes.bundleId === BUNDLE_PREFIX) ?? null;
}

function ours(text) {
  return /ardia|netnyahoo/i.test(text ?? "");
}

async function listBuilds(appId, build) {
  const params = {
    "filter[app]": appId,
    sort: "-uploadedDate",
    limit: "20",
    "fields[builds]": "version,uploadedDate,processingState,expired,usesNonExemptEncryption,minOsVersion,preReleaseVersion,buildBetaDetail",
    include: "preReleaseVersion,buildBetaDetail",
    "fields[preReleaseVersions]": "version",
    "fields[buildBetaDetails]": "internalBuildState,externalBuildState",
  };
  if (build) params["filter[version]"] = build;
  const { rows, included } = await get("/v1/builds", params);
  const byKey = new Map(included.map((row) => [`${row.type}:${row.id}`, row]));
  return rows.slice(0, 20).map((row) => {
    const related = (name) => {
      const link = row.relationships?.[name]?.data;
      return link ? byKey.get(`${link.type}:${link.id}`) : undefined;
    };
    return {
      version: related("preReleaseVersion")?.attributes.version ?? "?",
      build: row.attributes.version,
      uploaded: day(row.attributes.uploadedDate),
      processing: row.attributes.processingState,
      expired: row.attributes.expired,
      encryption: row.attributes.usesNonExemptEncryption,
      internal: related("buildBetaDetail")?.attributes.internalBuildState ?? "?",
      external: related("buildBetaDetail")?.attributes.externalBuildState ?? "?",
    };
  });
}

function printBuilds(builds) {
  if (builds.length === 0) console.log("none");
  for (const build of builds) {
    console.log(
      `${build.version} (${build.build}) uploaded ${build.uploaded} processing=${build.processing} ` +
        `internal=${build.internal} external=${build.external} encryption=${build.encryption} expired=${build.expired}`,
    );
  }
}

async function status() {
  let app = null;
  await section("App record", async () => {
    const apps = await listApps();
    app = apps.find((row) => row.attributes.bundleId === BUNDLE_PREFIX) ?? null;
    console.log(app ? `${app.attributes.name} ${app.attributes.bundleId} (id ${app.id})` : `none for ${BUNDLE_PREFIX}`);
    const related = apps.filter((row) => row !== app && (ours(row.attributes.bundleId) || ours(row.attributes.name)));
    for (const row of related) console.log(`also: ${row.attributes.name} ${row.attributes.bundleId}`);
    console.log(`${apps.length} app records visible to this key`);
  });

  await section("App IDs", async () => {
    const { rows: all, included } = await get("/v1/bundleIds", {
      "fields[bundleIds]": "identifier,platform,bundleIdCapabilities",
      include: "bundleIdCapabilities",
      limit: "200",
    });
    const capabilities = new Map(included.map((row) => [row.id, row.attributes.capabilityType]));
    const rows = all.filter((row) => ours(row.attributes.identifier));
    console.log(`${all.length} App IDs on the team, ${rows.length} of them Ardia's`);
    for (const row of rows) {
      const types = (row.relationships?.bundleIdCapabilities?.data ?? []).map((link) => capabilities.get(link.id) ?? "?");
      console.log(`${row.attributes.identifier} ${row.attributes.platform} [${types.sort().join(", ")}]`);
    }
  });

  await section("Devices", async () => {
    const { rows } = await get("/v1/devices", { "fields[devices]": "platform,deviceClass,status", limit: "200" });
    const counts = {};
    for (const row of rows) {
      const kind = `${row.attributes.deviceClass} ${row.attributes.status}`;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    console.log(rows.length === 0 ? "none" : Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(", "));
  });

  await section("Certificates", async () => {
    const { rows } = await get("/v1/certificates", { "fields[certificates]": "certificateType,expirationDate", limit: "200" });
    if (rows.length === 0) console.log("none");
    for (const row of rows) console.log(`${row.attributes.certificateType} expires ${day(row.attributes.expirationDate)}`);
  });

  await section("Profiles", async () => {
    const { rows } = await get("/v1/profiles", { "fields[profiles]": "name,profileType,profileState,expirationDate", limit: "200" });
    if (rows.length === 0) console.log("none");
    for (const row of rows) {
      const profile = row.attributes;
      console.log(`${profile.profileType} ${profile.profileState} expires ${day(profile.expirationDate)} ${profile.name}`);
    }
  });

  if (!app) return;

  await section("Builds", async () => printBuilds(await listBuilds(app.id)));

  await section("Encryption declarations", async () => {
    const { rows } = await get("/v1/appEncryptionDeclarations", { "filter[app]": app.id, limit: "50" });
    if (rows.length === 0) console.log("none");
    for (const row of rows) {
      const declaration = row.attributes;
      console.log(
        `code ${declaration.codeValue ?? "none"} state=${declaration.appEncryptionDeclarationState} exempt=${declaration.exempt} ` +
          `proprietary=${declaration.containsProprietaryCryptography} thirdParty=${declaration.containsThirdPartyCryptography} ` +
          `france=${declaration.availableOnFrenchStore} created ${day(declaration.createdDate)}`,
      );
    }
  });

  await section("Tester groups", async () => {
    const { rows } = await get(`/v1/apps/${app.id}/betaGroups`, { "fields[betaGroups]": "name,isInternalGroup,hasAccessToAllBuilds,publicLinkEnabled,publicLink" });
    if (rows.length === 0) console.log("none");
    for (const row of rows) {
      const group = row.attributes;
      const { rows: testers } = await get(`/v1/betaGroups/${row.id}/betaTesters`, { "fields[betaTesters]": "state", limit: "200" });
      const states = {};
      for (const tester of testers) states[tester.attributes.state ?? "?"] = (states[tester.attributes.state ?? "?"] ?? 0) + 1;
      const summary = Object.entries(states).map(([state, count]) => `${count} ${state}`).join(", ") || "none";
      console.log(
        `${group.name} ${group.isInternalGroup ? "internal" : "external"} allBuilds=${group.hasAccessToAllBuilds} ` +
          `publicLink=${group.publicLinkEnabled ? group.publicLink : group.publicLinkEnabled} testers: ${summary}`,
      );
    }
  });

  await section("Beta review details", async () => {
    const { rows } = await get(`/v1/apps/${app.id}/betaAppReviewDetail`, {
      "fields[betaAppReviewDetails]": "contactEmail,demoAccountRequired,notes",
    });
    const detail = rows[0]?.attributes;
    console.log(detail ? `contact ${detail.contactEmail ? "set" : "missing"}, notes ${detail.notes ? "set" : "missing"}` : "none");
  });

  await section("Beta test info", async () => {
    const { rows } = await get(`/v1/apps/${app.id}/betaAppLocalizations`, { limit: "50" });
    if (rows.length === 0) console.log("none");
    for (const row of rows) {
      const info = row.attributes;
      console.log(
        `${info.locale}: description ${info.description ? `${info.description.length} chars` : "missing"}, ` +
          `feedback email ${info.feedbackEmail ? "set" : "missing"}, privacy policy ${info.privacyPolicyUrl ?? "missing"}, ` +
          `marketing ${info.marketingUrl ?? "missing"}`,
      );
    }
  });
}

function option(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

async function requireApp() {
  const app = await findApp();
  if (!app) {
    console.error(`asc: no app record for ${BUNDLE_PREFIX}`);
    process.exit(1);
  }
  return app;
}

async function builds(args) {
  const app = await requireApp();
  printBuilds(await listBuilds(app.id, option(args, "--build")));
}

async function deliveryRefusal(appId, build) {
  try {
    const { rows } = await get(`/v1/apps/${appId}/buildUploads`, { "filter[cfBundleVersion]": build, limit: "10" });
    const failed = rows.find((row) => row.attributes?.state?.state === "FAILED");
    if (!failed) return null;
    const errors = failed.attributes.state.errors ?? [];
    return errors.map((error) => `${error.code ?? ""} ${error.description ?? ""}`.trim()).join("\n") || "no reason given";
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

async function wait(args) {
  const build = option(args, "--build");
  if (!build) {
    console.error("asc: wait needs --build <number>");
    process.exit(64);
  }
  const deadline = Date.now() + Number(option(args, "--timeout") ?? 1500) * 1000;
  const app = await requireApp();
  let last = "";
  while (Date.now() < deadline) {
    const [found] = await listBuilds(app.id, build);
    const awaitsTesterState = found?.processing === "VALID" && found.internal === "?";
    const state = !found ? "not listed yet" : awaitsTesterState ? "VALID, not ready for testers yet" : found.processing;
    if (!found) {
      const refusal = await deliveryRefusal(app.id, build);
      if (refusal) {
        console.error(`asc: App Store Connect refused build ${build}:\n${refusal}`);
        process.exit(1);
      }
    }
    if (state !== last) console.log(`build ${build}: ${state}`);
    last = state;
    if (found && found.processing !== "PROCESSING" && !awaitsTesterState) {
      printBuilds([found]);
      process.exit(found.processing === "VALID" ? 0 : 1);
    }
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  console.error(`asc: build ${build} was still ${last} at the deadline`);
  process.exit(124);
}

async function uploadedBuildNumbers(appId) {
  try {
    const { rows } = await get(`/v1/apps/${appId}/buildUploads`, { limit: "200" });
    return rows.map((row) => row.attributes?.cfBundleVersion);
  } catch (error) {
    if (error instanceof ApiError) return [];
    throw error;
  }
}

async function nextBuild() {
  const app = await requireApp();
  const seen = [...(await listBuilds(app.id)).map((build) => build.build), ...(await uploadedBuildNumbers(app.id))];
  console.log(Math.max(0, ...seen.map(Number).filter(Number.isInteger)) + 1);
}

async function createCertificate(requestPath, out) {
  const made = await post("/v1/certificates", {
    data: { type: "certificates", attributes: { certificateType: "DEVELOPMENT", csrContent: readFileSync(requestPath, "utf8") } },
  });
  writeFileSync(out, Buffer.from(made.attributes.certificateContent, "base64"));
  console.log(`created a ${made.attributes.certificateType} certificate, expires ${day(made.attributes.expirationDate)}`);
}

async function certificates(args) {
  const create = option(args, "--create");
  if (create) {
    const out = option(args, "--out");
    if (!out) {
      console.error("asc: certificates --create needs --out <file.cer>");
      process.exit(64);
    }
    await createCertificate(create, out);
    return;
  }
  const { rows } = await get("/v1/certificates", { "fields[certificates]": "certificateType,expirationDate", limit: "200" });
  const save = option(args, "--save");
  const since = option(args, "--new-since");
  if (save) {
    writeFileSync(save, JSON.stringify(rows.map((row) => row.id)));
    console.log(`${rows.length} certificates recorded`);
    return;
  }
  if (!since) {
    console.error("asc: certificates needs --save, --new-since or --create");
    process.exit(64);
  }
  const before = new Set(JSON.parse(readFileSync(since, "utf8")));
  const made = rows.filter((row) => !before.has(row.id));
  for (const row of made) console.log(`new ${row.attributes.certificateType} certificate, expires ${day(row.attributes.expirationDate)}`);
  if (made.length === 0) console.log("no new certificates");
  if (made.some((row) => DEVELOPMENT_CERTIFICATES.has(row.attributes.certificateType))) process.exit(1);
}

async function onceListed(action) {
  const deadline = Date.now() + 180000;
  for (;;) {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404 || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
}

async function unlessAlready(action, done) {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof ApiError) || ![409, 422].includes(error.status)) throw error;
    console.log(`${done}: ${error.message}`);
  }
}

async function publicLink(args) {
  const number = option(args, "--build");
  if (!number) {
    console.error("asc: public-link needs --build <number>");
    process.exit(64);
  }
  const app = await requireApp();
  const { rows: found } = await get("/v1/builds", { "filter[app]": app.id, "filter[version]": number, "fields[builds]": "version,processingState" });
  const build = found[0];
  if (!build || build.attributes.processingState !== "VALID") {
    console.error(`asc: build ${number} is ${build ? build.attributes.processingState : "not on App Store Connect"}`);
    process.exit(1);
  }

  const policy = option(args, "--privacy-policy");
  if (policy) {
    const { rows } = await get(`/v1/apps/${app.id}/betaAppLocalizations`, { limit: "50" });
    for (const row of rows.filter((row) => row.attributes.privacyPolicyUrl !== policy)) {
      await patch(`/v1/betaAppLocalizations/${row.id}`, { data: { type: "betaAppLocalizations", id: row.id, attributes: { privacyPolicyUrl: policy } } });
      console.log(`privacy policy set for ${row.attributes.locale}`);
    }
  }

  const notesPath = option(args, "--what-to-test");
  if (notesPath) {
    const whatsNew = readFileSync(notesPath, "utf8").trim();
    const { rows } = await get(`/v1/builds/${build.id}/betaBuildLocalizations`, { limit: "50" });
    if (rows.length === 0) {
      await post("/v1/betaBuildLocalizations", {
        data: { type: "betaBuildLocalizations", attributes: { locale: "en-US", whatsNew }, relationships: { build: { data: { type: "builds", id: build.id } } } },
      });
    }
    for (const row of rows) {
      await patch(`/v1/betaBuildLocalizations/${row.id}`, { data: { type: "betaBuildLocalizations", id: row.id, attributes: { whatsNew } } });
    }
    console.log("What to Test set");
  }

  const fields = { "fields[betaGroups]": "name,isInternalGroup,publicLinkEnabled,publicLink" };
  const { rows: groups } = await get(`/v1/apps/${app.id}/betaGroups`, fields);
  let group = groups.find((row) => !row.attributes.isInternalGroup && row.attributes.name === PUBLIC_GROUP);
  if (!group) {
    group = await post("/v1/betaGroups", {
      data: {
        type: "betaGroups",
        attributes: { name: PUBLIC_GROUP, publicLinkEnabled: true, publicLinkLimitEnabled: false, feedbackEnabled: true },
        relationships: { app: { data: { type: "apps", id: app.id } } },
      },
    });
    console.log(`created the ${PUBLIC_GROUP} group`);
  }

  await unlessAlready(
    () => onceListed(() => post(`/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: "builds", id: build.id }] })),
    "build already in the group",
  );
  await unlessAlready(
    () => post("/v1/betaAppReviewSubmissions", { data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: build.id } } } } }),
    "not submitted",
  );

  const { rows: after } = await get(`/v1/betaGroups/${group.id}`, fields);
  printBuilds(await listBuilds(app.id, number));
  console.log(`public link: ${after[0].attributes.publicLink ?? "none yet"}`);
}

async function addTester(args) {
  const email = option(args, "--email")?.trim().toLowerCase();
  const groupName = option(args, "--group") ?? PUBLIC_GROUP;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("asc: add-tester needs --email <address>");
    process.exit(64);
  }
  const app = await requireApp();
  const { rows: groups } = await get(`/v1/apps/${app.id}/betaGroups`, { "fields[betaGroups]": "name,isInternalGroup" });
  const group = groups.find((row) => !row.attributes.isInternalGroup && row.attributes.name === groupName);
  if (!group) {
    console.error(`asc: no external group named ${groupName}; run public-link first`);
    process.exit(1);
  }
  const { rows: existing } = await get("/v1/betaTesters", { "filter[email]": email, "fields[betaTesters]": "state", limit: "10" });
  if (existing.length === 0) {
    await post("/v1/betaTesters", {
      data: { type: "betaTesters", attributes: { email }, relationships: { betaGroups: { data: [{ type: "betaGroups", id: group.id }] } } },
    });
    console.log(`tester invited to ${groupName}`);
  } else {
    await unlessAlready(
      () => post(`/v1/betaGroups/${group.id}/relationships/betaTesters`, { data: [{ type: "betaTesters", id: existing[0].id }] }),
      "tester already in the group",
    );
    console.log(`tester (${existing[0].attributes.state ?? "?"}) is in ${groupName}`);
  }
  const { rows: testers } = await get(`/v1/betaGroups/${group.id}/betaTesters`, { "fields[betaTesters]": "state", limit: "200" });
  console.log(`${groupName} now has ${testers.length} testers`);
}

async function expire(args) {
  const number = option(args, "--build");
  if (!number) {
    console.error("asc: expire needs --build <number>");
    process.exit(64);
  }
  const app = await requireApp();
  const { rows } = await get("/v1/builds", { "filter[app]": app.id, "fields[builds]": "version,expired", limit: "200" });
  const build = rows.find((row) => row.attributes.version === number);
  if (!build) {
    console.error(`asc: build ${number} is not on App Store Connect`);
    process.exit(1);
  }
  const live = rows.filter((row) => !row.attributes.expired).map((row) => Number(row.attributes.version));
  if (build.attributes.expired) {
    console.log(`build ${number} was already expired`);
  } else if (Number(number) >= Math.max(...live)) {
    console.error(`asc: build ${number} is the newest one testers have; expire an older build`);
    process.exit(1);
  } else {
    await patch(`/v1/builds/${build.id}`, { data: { type: "builds", id: build.id, attributes: { expired: true } } });
    console.log(`build ${number} expired`);
  }
  printBuilds(await listBuilds(app.id));
}

const [command, ...args] = process.argv.slice(2);
const commands = { status, builds, wait, certificates, "next-build": nextBuild, "public-link": publicLink, "add-tester": addTester, expire };
if (!command || command === "-h" || command === "--help" || !commands[command]) {
  console.log(HELP);
  process.exit(command && commands[command] === undefined && command !== "-h" && command !== "--help" ? 64 : 0);
}
await commands[command](args);
