#!/usr/bin/env bash
set -euo pipefail

vendor="$(cd "$(dirname "$0")/.." && pwd)/vendor"

UBO_VERSION="1.75.0"
UBO_SHA256="393cf95709d1074d4022970e9014e434395c53a822387f1e25f43be97cf4b582"
UBO_KEY="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv1MPdIgJjIsN4Y0N/20GDNPfN4J//aknk5dsH8Y1LBxSnz3Jp/BT187Gub5cv6lee5CUVDmVBa3Yiqow8GMna5KwX+ZP+yc1pt/ewzyNxm2BzoQPgWz+1DgZaahz56/szi1EEtWVYxd3wNxFN4wPDqwV6aqlnV4R3RnxlF1ocw1kDgJ+8BxR1EY+MB+H8bymdef+xB3TNifBZIVmZt81cC3UMOG6KWRTU1wtIXsW+ZqSv5zaeFHLkjG4MPB7EfcMGrvO80ElJBZZLdrTmYOL4uUPsz2Wy6GiPWzpDmzzI9RfsZm11sLiJo63blcPF0Cz3sM0wQfxJPPcQuqkZDReswIDAQAB"
UBO_PATCH="22"
ubo="$vendor/ubo"
stamp="$UBO_VERSION-$UBO_PATCH"
zip="$ubo/uBlock0_$UBO_VERSION.chromium.zip"
zip_verified() { [ -f "$zip" ] && [ "$(shasum -a 256 "$zip" | awk '{ print $1 }')" = "$UBO_SHA256" ]; }
installed() { [ -z "${UBO_REINSTALL:-}" ] && [ -f "$ubo/.version" ] && [ "$(cat "$ubo/.version")" = "$stamp" ] && zip_verified; }
if ! installed && [ -z "${UBO_LOCKED:-}" ]; then
  mkdir -p "$ubo"
  UBO_LOCKED=1 exec lockf -k -t 600 "$ubo/.lock" "$0"
fi
if ! installed; then
  if [ -f "$zip" ] && ! zip_verified; then
    echo "$zip doesn't match its SHA-256; downloading it again" >&2
    rm -f "$zip"
  fi
  if [ ! -f "$zip" ]; then
    url="https://github.com/gorhill/uBlock/releases/download/$UBO_VERSION/uBlock0_$UBO_VERSION.chromium.zip"
    echo "Downloading $url"
    curl -fL --retry 3 -o "$zip.part" "$url"
    mv "$zip.part" "$zip"
  fi
  echo "$UBO_SHA256  $zip" | shasum -a 256 -c -
  rm -rf "$ubo/unzip" "$ubo/ext.new" "$ubo/ext.old"
  unzip -q "$zip" -d "$ubo/unzip"
  mv "$ubo/unzip/uBlock0.chromium" "$ubo/ext.new"
  rm -rf "$ubo/unzip"
  python3 -I - "$ubo/ext.new" "$UBO_KEY" "$UBO_PATCH" <<'PY'
import json, os, sys
ext, key, level = sys.argv[1], sys.argv[2], sys.argv[3]
path = os.path.join(ext, "manifest.json")
manifest = json.load(open(path))
manifest["key"] = key
manifest["version_name"] = manifest["version"]
manifest["version"] = f"{manifest['version']}.{level}"
manifest["incognito"] = "spanning"
web = ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"]
if manifest["permissions"].count("<all_urls>") != 1:
    sys.exit("ubo.sh: manifest.json no longer asks for <all_urls>")
manifest["permissions"] = [p for p in manifest["permissions"] if p != "<all_urls>"] + web
scripts = manifest["content_scripts"]
kept = [entry for entry in scripts if entry["js"] not in (["/js/scriptlets/subscriber.js"], ["/js/scriptlets/updater.js"])]
if len(kept) != len(scripts) - 2:
    sys.exit("ubo.sh: manifest.json no longer has the subscriber and updater content scripts")
manifest["content_scripts"] = kept
storage = manifest.get("storage")
if not isinstance(storage, dict) or "managed_schema" not in storage:
    sys.exit("ubo.sh: manifest.json no longer declares storage.managed_schema")
del storage["managed_schema"]
if not storage:
    del manifest["storage"]
json.dump(manifest, open(path, "w"), indent=2)
def patch(rel, old, new):
    path = os.path.join(ext, rel)
    source = open(path).read()
    if source.count(old) != 1:
        sys.exit(f"ubo.sh: {rel} no longer has exactly one {old.strip().splitlines()[0]!r}")
    open(path, "w").write(source.replace(old, new))
patch("js/background.js", "prefetchingDisabled: true,", "prefetchingDisabled: false,")
patch("js/background.js", "    noDashboard: false,", "    noDashboard: true,")
patch("js/background.js", "    autoUpdateDelayAfterLaunch: 37,", "    autoUpdateDelayAfterLaunch: 600,")
patch("js/background.js", "    showIconBadge: true,", "    showIconBadge: false,")
patch("js/background.js", "    contextMenuEnabled: true,", "    contextMenuEnabled: false,")
patch("js/contextmenu.js", "    newBits |= SUBSCRIBE_TO_LIST_BIT;\n", "")
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
patch("js/diff-updater.js",
      "const resolveURL = (path, url) => {\n",
      "const ardiaPatchAllowed = (patchPath, base, patchURL) => {\n"
      "    if ( typeof patchPath !== 'string' || /^(?:[a-z][a-z0-9+.-]*:|[\\\\/])/i.test(patchPath) ) { return false; }\n"
      "    let baseURL;\n"
      "    try { baseURL = new URL(base); } catch { return false; }\n"
      "    if ( patchURL.origin !== baseURL.origin ) { return false; }\n"
      "    const directory = baseURL.pathname.slice(0, baseURL.pathname.lastIndexOf('/') + 1);\n"
      "    const parent = directory.slice(0, directory.slice(0, -1).lastIndexOf('/') + 1) || '/';\n"
      "    return patchURL.pathname.startsWith(parent);\n"
      "};\n"
      "\n"
      "const ardiaPatchCacheKey = assetDetails =>\n"
      "    [ assetDetails.assetKey, assetDetails.patchPath, ...(assetDetails.patchURLs || assetDetails.cdnURLs || []) ].join('\\n');\n"
      "\n"
      "const resolveURL = (path, url) => {\n")
patch("js/diff-updater.js",
      "    const patchFile = basename(patchPath);\n"
      "    return patchFile !== '' && patches.has(patchFile);\n",
      "    const patchFile = basename(patchPath);\n"
      "    return patchFile !== '' && patches.has(ardiaPatchCacheKey(assetDetails));\n")
patch("js/diff-updater.js",
      "    if ( patches.has(patchFile) ) {\n"
      "        return patches.get(patchFile);\n"
      "    }\n"
      "    const patchDetailsPromise = fetchPatchDetailsFromCDNs(assetDetails);\n"
      "    patches.set(patchFile, patchDetailsPromise);\n",
      "    const patchCacheKey = ardiaPatchCacheKey(assetDetails);\n"
      "    if ( patches.has(patchCacheKey) ) {\n"
      "        return patches.get(patchCacheKey);\n"
      "    }\n"
      "    const patchDetailsPromise = fetchPatchDetailsFromCDNs(assetDetails);\n"
      "    patches.set(patchCacheKey, patchDetailsPromise);\n")
patch("js/diff-updater.js",
      "        const patchURL = resolveURL(patchPath, cdnURL);\n"
      "        if ( patchURL === undefined ) { continue; }\n",
      "        const patchURL = resolveURL(patchPath, cdnURL);\n"
      "        if ( patchURL === undefined ) { continue; }\n"
      "        if ( ardiaPatchAllowed(patchPath, cdnURL, patchURL) === false ) { continue; }\n")
patch("js/diff-updater.js",
      "        const response = await fetch(patchURL).catch(reason => {\n"
      "            console.error(reason, patchURL);\n"
      "        });\n"
      "        if ( response === undefined ) { continue; }\n"
      "        if ( response.status === 404 ) { break; }\n"
      "        if ( response.ok !== true ) { continue; }\n"
      "        const patchText = await response.text();\n",
      "        const controller = new AbortController();\n"
      "        const deadline = setTimeout(( ) => { controller.abort(); }, 30000);\n"
      "        const stop = ( ) => { clearTimeout(deadline); controller.abort(); };\n"
      "        const response = await fetch(patchURL, { signal: controller.signal }).catch(reason => {\n"
      "            console.error(reason, patchURL);\n"
      "        });\n"
      "        const sameOrigin = response !== undefined && typeof response.url === 'string' &&\n"
      "            response.url.startsWith(patchURL.origin + '/');\n"
      "        if ( response === undefined || sameOrigin === false ) { stop(); continue; }\n"
      "        if ( response.status === 404 ) { stop(); break; }\n"
      "        if ( response.ok !== true ) { stop(); continue; }\n"
      "        const patchText = await response.text().catch(( ) => undefined);\n"
      "        clearTimeout(deadline);\n"
      "        if ( patchText === undefined ) { continue; }\n")
patch("js/storage.js",
      "            const match = /^[a-z]+/.exec(i18n.getUILanguage());\n"
      "            if ( match !== null ) {\n"
      "                re = new RegExp('\\\\b' + match[0] + '\\\\b');",
      "            const langs = new Set([ i18n.getUILanguage(), ...(self.navigator.languages || []) ]\n"
      "                .map(lang => (/^[a-z]+/.exec(lang) || [])[0]).filter(Boolean));\n"
      "            if ( langs.size !== 0 ) {\n"
      "                re = new RegExp('\\\\b(?:' + Array.from(langs).join('|') + ')\\\\b');")
PY
  [ -d "$ubo/ext" ] && mv "$ubo/ext" "$ubo/ext.old"
  mv "$ubo/ext.new" "$ubo/ext"
  rm -rf "$ubo/ext.old"
  echo "$stamp" > "$ubo/.version"
fi
