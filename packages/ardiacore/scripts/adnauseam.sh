#!/usr/bin/env bash
set -euo pipefail

vendor="$(cd "$(dirname "$0")/.." && pwd)/vendor"

ADN_VERSION="3.29.2"
ADN_SHA256="2c7241dbd1ec71b16f2f8883830595b74e2603896f3f283ad500b070edbc9ac1"
ADN_KEY="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA21IVrEb/wGXSfjgU6K7ChmthS3hSwT0cKYvHnpHMV1+3+b8zitadv97Sd4KjG2VPP97/nFIiIWsSWB9aSKNeka8IITMlMoD0s4q8Y0LeHe2ylz4hOierZeXEa5sgOYWowbp2VAS4gkWIiH2FiiHffNGwkrNSYvz7Jl01cH+hW1syoNApy+AsuZTFVDFsBduH+mQjo0ATRsNacmF/8hPcpnapNyS7IJBRWnYGmSt6R4sSo0K1lXblXDbWEKNbHIuT1Wl99+jRERYbmpl3x+KPgQjZ0JqvtLd08EFvuZjEZiw1AtSsQSJQNMwG8lBBZYeEb23IKa09o73+rHi5uT/lpwIDAQAB"
ADN_ID="kmggppiioddbnikpjfodfabgmboeihij"
ADN_PATCH="1"
adn="$vendor/adnauseam"
stamp="$ADN_VERSION-$ADN_PATCH"
installed() { [ -f "$adn/.version" ] && [ "$(cat "$adn/.version")" = "$stamp" ]; }
if ! installed && [ -z "${ADN_LOCKED:-}" ]; then
  mkdir -p "$adn"
  ADN_LOCKED=1 exec lockf -k -t 600 "$adn/.lock" "$0"
fi
if ! installed; then
  zip="$adn/adnauseam-$ADN_VERSION.chromium.zip"
  if [ ! -f "$zip" ]; then
    url="https://github.com/dhowe/AdNauseam/releases/download/v$ADN_VERSION/adnauseam-$ADN_VERSION.chromium.zip"
    echo "Downloading $url"
    curl -fL --retry 3 -o "$zip.part" "$url"
    mv "$zip.part" "$zip"
  fi
  echo "$ADN_SHA256  $zip" | shasum -a 256 -c -
  rm -rf "$adn/unzip" "$adn/ext.new" "$adn/ext.old"
  unzip -q "$zip" -d "$adn/unzip"
  mv "$adn/unzip/adnauseam.chromium" "$adn/ext.new"
  rm -rf "$adn/unzip"
  python3 -I - "$adn/ext.new" "$ADN_KEY" "$ADN_ID" "$ADN_PATCH" <<'PY'
import base64, hashlib, json, os, sys
ext, key, expected_id, level = sys.argv[1:5]
digest = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
if "".join(chr(ord("a") + int(c, 16)) for c in digest) != expected_id:
    sys.exit("adnauseam.sh: ADN_KEY doesn't give ADN_ID")
path = os.path.join(ext, "manifest.json")
manifest = json.load(open(path))
manifest["key"] = key
manifest.pop("update_url", None)
manifest["version_name"] = manifest["version"]
manifest["version"] = f"{manifest['version']}.{level}"
if manifest.get("incognito") != "spanning":
    sys.exit("adnauseam.sh: manifest.json is no longer incognito: spanning")
web = ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"]
for permission in ("<all_urls>", "management"):
    if manifest["permissions"].count(permission) != 1:
        sys.exit(f"adnauseam.sh: manifest.json no longer asks for {permission}")
manifest["permissions"] = [p for p in manifest["permissions"] if p not in ("<all_urls>", "management")] + web
scripts = manifest["content_scripts"]
kept = [entry for entry in scripts if entry["js"] not in (["/js/scriptlets/subscriber.js"], ["/js/scriptlets/updater.js"])]
if len(kept) != len(scripts) - 2:
    sys.exit("adnauseam.sh: manifest.json no longer has the subscriber and updater content scripts")
manifest["content_scripts"] = kept
json.dump(manifest, open(path, "w"), indent=2)
def patch(rel, old, new):
    path = os.path.join(ext, rel)
    source = open(path).read()
    if source.count(old) != 1:
        sys.exit(f"adnauseam.sh: {rel} no longer has exactly one {old.strip().splitlines()[0]!r}")
    open(path, "w").write(source.replace(old, new))
patch("js/background.js", "    hidingAds: false,\n", "    hidingAds: true,\n")
patch("js/background.js", "    blockingMalware: false,\n", "    blockingMalware: true,\n")
patch("js/background.js", "    noDashboard: false,", "    noDashboard: true,")
patch("js/background.js", "    autoUpdateDelayAfterLaunch: 37,", "    autoUpdateDelayAfterLaunch: 600,")
patch("js/background.js", "    showIconBadge: true,", "    showIconBadge: false,")
patch("js/background.js", "    contextMenuEnabled: true,", "    contextMenuEnabled: false,")
patch("js/vapi-background.js",
      "        let version = manifest.version_name || manifest.version;\n",
      "        let version = manifest.version;\n")
patch("js/start.js",
      "    redirectEngine.invalidateResourcesSelfie(io);\n};\n",
      "    redirectEngine.invalidateResourcesSelfie(io);\n"
      "    µb.compiledFormatChanged = true;\n"
      "    µb.selfieManager.destroy();\n"
      "};\n")
patch("js/vapi-background.js",
      "    if ( webext.storage.managed instanceof Object === false ) {\n        return {",
      "    if ( true ) {\n        return {")
patch("js/vapi-background.js",
      "  if (typeof browser.management.getAll === 'function') {\n",
      "  if (typeof browser.management?.getAll === 'function') {\n")
patch("js/vapi-background.js",
      "            portDetails.tabURL = tab.url;\n",
      "            portDetails.tabURL = tab.url;\n"
      "            portDetails.ardiaIncognito = tab.incognito === true;\n")
patch("js/adn/core.js",
      "  let verifying = false; // true while verifyTarget() is pending for a visit\n",
      "  let verifying = false; // true while verifyTarget() is pending for a visit\n"
      "  let ardiaClickGeneration = 0;\n"
      "  const ardiaMayClick = () => self.ardiaClickConsent === true && µb.userSettings.clickingAds === true;\n"
      "  self.ardiaClickConsent = false;\n"
      "  self.ardiaStopClicks = function () {\n"
      "    ardiaClickGeneration++;\n"
      "    const pending = xhr;\n"
      "    xhr = null;\n"
      "    if (pending) {\n"
      "      pending.onload = pending.onerror = pending.ontimeout = null;\n"
      "      pending.abort();\n"
      "    }\n"
      "  };\n")
patch("js/adn/core.js",
      "    const hasClickInclusions = !settings.clickingAds && (settings.clickingExceptions || '').trim();\n"
      "    if (/*pending.length && */(settings.clickingAds || hasClickInclusions) && !isAutomated()) { // no visits if automated\n",
      "    if (ardiaMayClick() && !isAutomated()) {\n")
patch("js/adn/core.js",
      "  const isClickingAllowedOnDomain = function (domain) {\n",
      "  const isClickingAllowedOnDomain = function (domain) {\n"
      "    if (!ardiaMayClick()) return false;\n")
patch("js/adn/core.js",
      "      ad.visitedTs <= 0 && !ad.dntAllowed && !ad.noVisit;\n",
      "      ad.visitedTs <= 0 && !ad.dntAllowed && !ad.noVisit && !ad.private;\n")
patch("js/adn/core.js",
      "    if (verifying) return; // still verifying the previous target\n",
      "    if (verifying || !ardiaMayClick() || !ad || ad.private) return;\n")
patch("js/adn/core.js",
      "    verifying = true;\n"
      "    verifyTarget(target).then(ok => {\n"
      "      verifying = false;\n"
      "      if (!ok) return warn('[SKIP] not visiting, non-public target: ' + target);\n"
      "      sendXhr(ad, target);\n",
      "    verifying = true;\n"
      "    const ardiaGeneration = ardiaClickGeneration;\n"
      "    verifyTarget(target).then(ok => {\n"
      "      verifying = false;\n"
      "      if (!ok) return warn('[SKIP] not visiting, non-public target: ' + target);\n"
      "      if (ardiaGeneration !== ardiaClickGeneration) return warn('[SKIP] clicking was turned off: ' + target);\n"
      "      sendXhr(ad, target);\n")
patch("js/adn/core.js",
      "  const sendXhr = function (ad, target) {\n",
      "  const sendXhr = function (ad, target) {\n"
      "    if (!ardiaMayClick() || ad.private) return;\n")
patch("js/adn/core.js",
      "      callback(adnauseam[request.what](request, pageStore, tabId));\n",
      "      if (request.what === 'registerAd' && (sender?.ardiaIncognito === true || request.ad?.private === true)) return callback();\n"
      "      callback(adnauseam[request.what](request, pageStore, tabId));\n")
patch("js/adn/core.js", "      vAPI.tabs.open({ url, index: -1 });\n", "")
patch("js/adn/core.js", "    verifyVersion();\n", "")
PY
  [ -d "$adn/ext" ] && mv "$adn/ext" "$adn/ext.old"
  mv "$adn/ext.new" "$adn/ext"
  rm -rf "$adn/ext.old"
  echo "$stamp" > "$adn/.version"
fi
