import { execFile } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { LIVE_HOSTS } from "./liveServices.mjs";

const run = promisify(execFile);

export const TRUSTED_HOSTS = ["secure.ardia.test", "mixed.ardia.test", "suggestqueries.google.com", ...LIVE_HOSTS];
export const UNTRUSTED_HOSTS = ["badcert.ardia.test"];

const openssl = (dir, args) => run("openssl", args, { cwd: dir, timeout: 30000 });

export function spkiHash(certificatePem) {
  const der = createPublicKey(certificatePem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("base64");
}

export async function generateTls(dir) {
  await mkdir(dir, { recursive: true });
  const altNames = [...TRUSTED_HOSTS.map((host, index) => `DNS.${index + 1} = ${host}`), "IP.1 = 127.0.0.1"].join("\n");
  await writeFile(join(dir, "leaf.ext"), `basicConstraints = CA:FALSE\nkeyUsage = digitalSignature, keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = @names\n[names]\n${altNames}\n`);
  await writeFile(join(dir, "bad.ext"), `basicConstraints = CA:FALSE\nextendedKeyUsage = serverAuth\nsubjectAltName = ${UNTRUSTED_HOSTS.map((host) => `DNS:${host}`).join(",")}\n`);
  try {
    await openssl(dir, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=Ardia Acceptance Test CA", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
    await openssl(dir, ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", "/CN=secure.ardia.test/O=Ardia Acceptance"]);
    await openssl(dir, ["x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "2", "-sha256", "-extfile", "leaf.ext"]);
    await openssl(dir, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "bad.key", "-out", "bad.pem", "-days", "2", "-subj", "/CN=badcert.ardia.test", "-addext", `subjectAltName=${UNTRUSTED_HOSTS.map((host) => `DNS:${host}`).join(",")}`]);
  } catch (error) {
    throw new Error(`openssl could not generate the acceptance certificates (${error.code === "ENOENT" ? "openssl is not installed" : error.message})`);
  }
  const [caPem, leafPem, leafKey, badPem, badKey] = await Promise.all(["ca.pem", "leaf.pem", "leaf.key", "bad.pem", "bad.key"].map((name) => readFile(join(dir, name), "utf8")));
  const trustedSpki = spkiHash(leafPem);
  const untrustedSpki = spkiHash(badPem);
  if (trustedSpki === untrustedSpki) throw new Error("The trusted and untrusted acceptance certificates share a key");
  return {
    dir,
    ca: caPem,
    trusted: { cert: `${leafPem}${caPem}`, key: leafKey },
    untrusted: { cert: badPem, key: badKey },
    trustedSpki,
    untrustedSpki,
    chromiumArgs: [`--ignore-certificate-errors-spki-list=${trustedSpki}`],
  };
}
