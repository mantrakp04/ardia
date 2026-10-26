import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./prune-bundle.sh', import.meta.url));
const chromeLocales = 'af am ar bg bn ca cs da de el en en_GB es es_419 et fa fi fil fr gu he hi hr hu id it ja kn ko lt lv ml mr ms nb nl pl pt_BR pt_PT ro ru sk sl sr sv sw ta te th tr uk ur vi zh_CN zh_TW'.split(' ');
const uboLocales = 'ar az be bg bn br_FR bs ca cs cv cy da de el en en_GB eo es et eu fa fi fil fr fy gl gu he hi hr hu hy id it ja ka kk kn ko lt lv mk ml mr ms nb nl no oc pa pl pt_BR pt_PT ro ru si sk sl so sq sr sv sw ta te th tr uk ur vi zh_CN zh_TW'.split(' ');

function prune(t, { development, localizations, lproj = [], defaultLocale = 'en', binary = false, extraUboLocales = [] } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'ardia-prune-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const app = join(scratch, 'Ardia Test.app');
  const contents = join(app, 'Contents');
  const resources = join(contents, 'Resources');
  const versions = join(contents, 'Frameworks/Chromium Framework.framework/Versions');
  const chrome = join(versions, 'A/Resources');
  const ubo = join(resources, 'Extensions/ublock');
  mkdirSync(chrome, { recursive: true });
  mkdirSync(ubo, { recursive: true });
  symlinkSync('A', join(versions, 'Current'));
  const info = {};
  if (development !== undefined) info.CFBundleDevelopmentRegion = development;
  if (localizations !== undefined) info.CFBundleLocalizations = localizations;
  const plist = join(contents, 'Info.plist');
  writeFileSync(plist, JSON.stringify(info));
  execFileSync('/usr/bin/plutil', ['-convert', binary ? 'binary1' : 'xml1', plist], { timeout: 5000 });
  for (const locale of lproj) mkdirSync(join(resources, `${locale}.lproj`));
  for (const locale of chromeLocales) {
    mkdirSync(join(chrome, `${locale}.lproj`));
    writeFileSync(join(chrome, `${locale}.lproj/locale.pak`), locale);
  }
  writeFileSync(join(ubo, 'manifest.json'), JSON.stringify({ default_locale: defaultLocale ?? undefined }));
  for (const locale of [...uboLocales, ...extraUboLocales]) {
    mkdirSync(join(ubo, '_locales', locale), { recursive: true });
    writeFileSync(join(ubo, '_locales', locale, 'messages.json'), JSON.stringify({ locale }));
  }
  execFileSync('/bin/bash', [script, app], {
    timeout: 15000,
    env: {
      ...process.env,
      ARDIA_PRUNE: 'on',
      ARDIA_PRUNE_LOCALES: 'on',
      ARDIA_PRUNE_UBO_LOCALES: 'on',
      ARDIA_PRUNE_SWIFTSHADER: 'off',
      ARDIA_PRUNE_FIRST_RUN: 'off',
      ARDIA_PRUNE_RN_3X: 'off',
      ARDIA_STRIP_HERMES: 'off',
    },
  });
  const keptChrome = readdirSync(chrome).map(name => name.replace(/\.lproj$/, '')).sort();
  const keptUbo = readdirSync(join(ubo, '_locales')).sort();
  for (const locale of keptChrome) assert.equal(readFileSync(join(chrome, `${locale}.lproj/locale.pak`), 'utf8'), locale);
  for (const locale of keptUbo) assert.deepEqual(JSON.parse(readFileSync(join(ubo, '_locales', locale, 'messages.json'), 'utf8')), { locale });
  return { chrome: keptChrome, ubo: keptUbo };
}

function expectLocales(actual, chrome, ubo = chrome) {
  assert.deepEqual(actual.chrome, [...chrome].sort(), 'Chrome locales');
  assert.deepEqual(actual.ubo, [...ubo].sort(), 'uBO locales');
}

test('CFBundleLocalizations preserves declared locales without app lproj directories', t => {
  expectLocales(prune(t, { development: 'en', localizations: ['fr', 'de', 'ja'] }), ['en', 'de', 'fr', 'ja']);
});

test('without CFBundleLocalizations the development region and app lproj directories still apply', t => {
  expectLocales(prune(t, { development: 'fr', lproj: ['Base', 'de', 'pt-BR'] }), ['en', 'fr', 'de', 'pt_BR']);
});

test('empty CFBundleLocalizations preserves the existing language sources', t => {
  expectLocales(prune(t, { development: 'fr', localizations: [], lproj: ['de'] }), ['en', 'fr', 'de']);
});

test('CFBundleLocalizations adds to the development region and app lproj directories', t => {
  expectLocales(prune(t, { development: 'fr', localizations: ['ja'], lproj: ['Base', 'de'] }), ['en', 'fr', 'de', 'ja']);
});

test('development region and app lproj directories share the resource aliases', t => {
  expectLocales(prune(t, { development: 'es-ES', lproj: ['sv_SE', 'pt-PT', 'zh-CN'] }), ['en', 'es', 'sv', 'pt_PT', 'zh_CN']);
});

for (const separator of ['-', '_']) {
  test(`regional locales using ${separator} match the shipped resource names`, t => {
    const localizations = ['en-US', 'en-GB', 'es-ES', 'sv-SE', 'pt-BR', 'pt-PT', 'zh-CN', 'zh-TW'].map(locale => locale.replace('-', separator));
    expectLocales(prune(t, { localizations }), ['en', 'en_GB', 'es', 'sv', 'pt_BR', 'pt_PT', 'zh_CN', 'zh_TW']);
  });
}

for (const [declared, kept] of [['zh-CN', 'zh_CN'], ['zh_TW', 'zh_TW']]) {
  test(`${declared} keeps only its Chinese translation`, t => {
    expectLocales(prune(t, { localizations: [declared] }), ['en', kept]);
  });
}

test('English remains the fallback with no language declarations', t => {
  expectLocales(prune(t), ['en']);
});

test('uBO keeps its manifest default independently of declared languages', t => {
  expectLocales(prune(t, { localizations: ['fr'], defaultLocale: 'de' }), ['en', 'fr'], ['en', 'fr', 'de']);
});

test('uBO falls back to the English default when its manifest omits default_locale', t => {
  expectLocales(prune(t, { localizations: ['fr'], defaultLocale: null }), ['en', 'fr']);
});

test('Norwegian Bokmal keeps Chrome nb and both uBO nb and no resources', t => {
  expectLocales(prune(t, { localizations: ['nb'] }), ['en', 'nb'], ['en', 'nb', 'no']);
});

test('uBO keeps a no manifest default without enabling Chrome nb', t => {
  expectLocales(prune(t, { defaultLocale: 'no' }), ['en'], ['en', 'no']);
});

test('uBO keeps Irish and Nynorsk locale parents without corresponding Chrome pak files', t => {
  const ubo = ['ga_IE', 'ga', 'nn_NO', 'nn'];
  expectLocales(prune(t, { localizations: ['ga-IE', 'nn-NO'], extraUboLocales: ubo }), ['en'], ['en', ...ubo]);
});

test('uBO retains supported regional locale parents independently of Chrome', t => {
  const chrome = ['en', 'en_GB', 'pt_BR', 'pt_PT', 'zh_CN', 'zh_TW'];
  expectLocales(prune(t, {
    localizations: ['en-GB', 'pt-BR', 'pt-PT', 'zh-CN', 'zh-TW'],
    extraUboLocales: ['pt', 'zh'],
  }), chrome, [...chrome, 'pt', 'zh']);
});

test('unknown regional locales do not retain unrelated language or regional resources', t => {
  expectLocales(prune(t, { localizations: ['zz-ZZ', 'fr-XX', 'pt-XX', 'zh-XX', 'en-XX', 'nb-XX'] }), ['en']);
});

test('binary Info.plist declarations are read through plutil', t => {
  expectLocales(prune(t, { localizations: ['fr', 'zh-TW'], binary: true }), ['en', 'fr', 'zh_TW']);
});

test('the 41 Zen release locales keep available translations and exclude eu', t => {
  const localizations = 'en-US ar bg bs ca cs cy da de el en-GB es-ES et fa fi fr ga-IE he hu id is it ja ko lt nb nl nn-NO pl pt-BR pt-PT ro ru sk sv-SE th tr uk vi zh-CN zh-TW'.split(' ');
  const chrome = 'en ar bg ca cs da de el en_GB es et fa fi fr he hu id it ja ko lt nb nl pl pt_BR pt_PT ro ru sk sv th tr uk vi zh_CN zh_TW'.split(' ');
  assert.equal(localizations.length, 41);
  assert.equal(chrome.length, 36);
  expectLocales(prune(t, { localizations }), chrome, [...chrome, 'bs', 'cy', 'no']);
});
