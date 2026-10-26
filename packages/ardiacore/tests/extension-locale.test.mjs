import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const ios = fileURLToPath(new URL('../ios/', import.meta.url));
const locales = 'en-US ar bg bs ca cs cy da de el en-GB es-ES et fa fi fr ga-IE he hu id is it ja ko lt nb nl nn-NO pl pt-BR pt-PT ro ru sk sv-SE th tr uk vi zh-CN zh-TW'.split(' ');
const scratch = mkdtempSync('/tmp/ardia-extension-locale-');
const app = join(scratch, 'Locale Probe.app');
const binary = join(app, 'Contents/MacOS/LocaleProbe');

after(() => rmSync(scratch, { recursive: true, force: true }));

before(() => {
  mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents/Resources'));
  const plist = join(app, 'Contents/Info.plist');
  writeFileSync(plist, JSON.stringify({
    CFBundleExecutable: 'LocaleProbe',
    CFBundleIdentifier: 'dev.ardia.extension-locale-test',
    CFBundlePackageType: 'APPL',
    CFBundleDevelopmentRegion: 'en-US',
    CFBundleLocalizations: locales,
  }));
  execFileSync('/usr/bin/plutil', ['-convert', 'xml1', plist], { timeout: 5000 });
  const main = join(scratch, 'main.mm');
  writeFileSync(main, `#import "ArdiaExtensionPackage.h"
#include <cstdio>

int main(int argc, const char *argv[]) {
  if (argc < 2) return 2;
  @autoreleasepool {
    NSDictionary *out = @{
      @"bundle": NSBundle.mainBundle.bundlePath,
      @"selected": NSBundle.mainBundle.preferredLocalizations,
      @"languages": NSLocale.preferredLanguages,
      @"manifest": ardia_extensions::ReadManifest([NSString stringWithUTF8String:argv[1]])
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
    if (!data) return 3;
    fwrite(data.bytes, 1, data.length, stdout);
  }
  return 0;
}
`);
  execFileSync('xcrun', ['clang++', '-fobjc-arc', '-std=c++20', '-framework', 'Foundation', '-I', ios,
    join(ios, 'ArdiaExtensionPackage.mm'), main, '-o', binary], { timeout: 60000 });
});

function readManifest(t, languages, selected, messages = {}, manifest = {}) {
  const folder = mkdtempSync(join(scratch, 'extension-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    version: '1.0',
    name: '__MSG_name__',
    short_name: '__MSG_short__',
    description: '__MSG_description__',
    action: { default_title: '__MSG_action__' },
    default_locale: 'en',
    ...manifest,
  }));
  for (const [locale, entries] of Object.entries(messages)) {
    const path = join(folder, '_locales', locale);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'messages.json'), JSON.stringify(entries));
  }
  const appleLanguages = `(${languages.map(language => JSON.stringify(language)).join(',')})`;
  const result = JSON.parse(execFileSync(binary, [folder, '-AppleLanguages', appleLanguages], { encoding: 'utf8', timeout: 10000 }));
  assert.equal(result.bundle, app, 'Foundation must load the temporary app bundle');
  assert.deepEqual(result.languages, languages, 'AppleLanguages must apply to this process');
  assert.equal(result.selected[0], selected, 'NSBundle must negotiate the expected app localization');
  return result.manifest;
}

const message = value => ({ message: value });

test('bundle negotiates the 41 declared locales and Chinese system variants', t => {
  assert.equal(locales.length, 41);
  for (const locale of locales) readManifest(t, [locale], locale, {}, { name: 'Probe' });
  for (const [language, selected] of [
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['eu', 'en-US'],
  ]) readManifest(t, [language], selected, {}, { name: 'Probe' });
  readManifest(t, ['eu', 'fr'], 'fr', {}, { name: 'Probe' });
});

for (const locale of locales) {
  test(`${locale} uses the app-selected extension locale`, t => {
    const directory = locale.replaceAll('-', '_');
    const name = `Localized ${locale}`;
    const messages = { en: { name: message('English') }, [directory]: { name: message(name) } };
    assert.equal(readManifest(t, [locale], locale, messages).name, name);
  });
}

for (const [language, selected, directory] of [
  ['zh-Hans-CN', 'zh-CN', 'zh_CN'],
  ['zh-Hant-TW', 'zh-TW', 'zh_TW'],
  ['zh-Hant-HK', 'zh-TW', 'zh_TW'],
  ['zh-HK', 'zh-TW', 'zh_TW'],
]) {
  test(`${language} resolves the selected Chinese resource directory`, t => {
    const messages = {
      en: { name: message('English') },
      zh: { name: message('Parent Chinese') },
      zh_CN: { name: message('Simplified Chinese') },
      zh_TW: { name: message('Traditional Chinese') },
    };
    assert.equal(readManifest(t, [language], selected, messages).name, messages[directory].name.message);
  });
}

test('an unsupported system language uses English even if the extension translates it', t => {
  const messages = { eu: { name: message('Unsupported') }, en: { name: message('English') } };
  assert.equal(readManifest(t, ['eu'], 'en-US', messages).name, 'English');
});

test('an unsupported first language cannot override a later app-supported language', t => {
  const messages = { eu: { name: message('Unsupported') }, fr: { name: message('French') }, en: { name: message('English') } };
  assert.equal(readManifest(t, ['eu', 'fr'], 'fr', messages).name, 'French');
});

for (const [locale, parent] of [['ga-IE', 'ga'], ['nn-NO', 'nn']]) {
  test(`${locale} falls back to its parent directory`, t => {
    const messages = { [parent]: { name: message(`Parent ${parent}`) }, en: { name: message('English') } };
    assert.equal(readManifest(t, [locale], locale, messages).name, `Parent ${parent}`);
  });
}

test('missing words merge current, parent and manifest default case-insensitively without adding English', t => {
  const messages = {
    ga_IE: { NaMe: message('Current') },
    ga: { NAME: message('Parent name'), DeScRiPtIoN: message('Parent description') },
    fr: { name: message('Default name'), DESCRIPTION: message('Default description'), ShOrT: message('Default short') },
    en: { name: message('English name'), description: message('English description'), SHORT: message('English short'), AcTiOn: message('English action') },
  };
  const manifest = readManifest(t, ['ga-IE'], 'ga-IE', messages, { default_locale: 'fr' });
  assert.equal(manifest.name, 'Current');
  assert.equal(manifest.description, 'Parent description');
  assert.equal(manifest.shortName, 'Default short');
  assert.equal(manifest.actionTitle, undefined);
  assert.equal(JSON.stringify(manifest).includes('__MSG_'), false);
});

test('a later system preference cannot replace the selected locale or manifest default', t => {
  const messages = {
    fr: { name: message('French') },
    de: { description: message('Other system preference') },
    en: { description: message('Manifest default') },
  };
  const manifest = readManifest(t, ['fr', 'de'], 'fr', messages);
  assert.equal(manifest.name, 'French');
  assert.equal(manifest.description, 'Manifest default');
});

test('English and en_US remain fallbacks when default_locale is missing', t => {
  const messages = { en: { name: message('English') }, en_US: { description: message('US fallback') } };
  const manifest = readManifest(t, ['fr'], 'fr', messages, { default_locale: undefined });
  assert.equal(manifest.name, 'English');
  assert.equal(manifest.description, 'US fallback');
});

test('missing messages never escape as unresolved manifest tokens', t => {
  const manifest = readManifest(t, ['fr'], 'fr');
  assert.equal(manifest.name, '');
  assert.equal(manifest.description, '');
  assert.equal(manifest.shortName, undefined);
  assert.equal(manifest.actionTitle, undefined);
  assert.equal(JSON.stringify(manifest).includes('__MSG_'), false);
});

test('an empty current message still overrides a nonempty default', t => {
  const messages = { fr: { NAME: message('') }, en: { name: message('English') } };
  assert.equal(readManifest(t, ['fr'], 'fr', messages).name, '');
});

test('literal metadata and invalid selected message validation retain their behavior', t => {
  assert.equal(readManifest(t, ['fr'], 'fr', {}, { name: 'Literal name' }).name, 'Literal name');
  const manifest = readManifest(t, ['fr'], 'fr', { fr: { name: { message: 7 } } });
  assert.equal(manifest.error, 'The localization file _locales/fr/messages.json is invalid');
});
