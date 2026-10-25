import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { devtools, launch, session, sleep } from '../../../scripts/lib/instance.mjs';

const output = resolve('apps/browser/build-unified/site-protection');
mkdirSync(output, { recursive: true });
const results = [], requests = [], failures = [], clients = [];
let app, background, page, hold = true;
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/banner.svg') {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="250"><rect width="300" height="250" fill="blue"/></svg>');
  } else {
    const id = new URL(req.url, 'http://localhost').searchParams.get('ad') || 'first';
    res.setHeader('Content-Type', 'text/html');
    res.end(`<title>Site pause test</title><h1>Normal content</h1><div class="ad-slot"><a href="https://ads.ardia-test.example.net/click?ad=${encodeURIComponent(id)}"><img src="/banner.svg" width="300" height="250"></a></div>`);
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://ardia-fixture.example.org:${server.address().port}/`;
const until = async (label, read, ms = 30000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await read()) return;
  throw Error(`Timed out: ${label}`);
};
const record = name => { results.push({ name, passed: true }); console.log('PASS', name); };
const connect = async target => { const c = await devtools(target); clients.push(c); return c; };
const cef = code => app.eval(`return expo.modules.ArdiaCEF.${code};`, { timeout: 60000 });
const state = () => cef(`getPrivacySettings('', ${JSON.stringify(url)})`);
const ads = () => background.eval('adnauseam.adlist().map(a=>({url:a.targetUrl,visited:a.visitedTs,attempts:a.attempts}))');
const openPanel = async () => {
  await app.eval(`const tab=Object.values(ac.store.getState().tabs).find(t=>t.url.startsWith(${JSON.stringify(url)}));if(!tab)throw Error('missing fixture tab');ac.pageState.setState(s=>({popover:{...s.popover,[tab.id]:'protection'}}));return true;`);
  await until('site toggle ready', () => app.eval('return acPerf.findFibers("Toggle").some(f=>f.memoizedProps.label==="Block ads and trackers on this site"&&!f.memoizedProps.disabled);'));
};
const toggle = async value => {
  await openPanel();
  await app.eval(`acPerf.findFibers('Toggle').find(f=>f.memoizedProps.label==='Block ads and trackers on this site').memoizedProps.onChange(${value});return true;`);
  await until('site state applied', async () => (await state()).blocking === value);
  await until('shield state applied', () => app.eval(`return acPerf.findFibers('ToolbarButton').some(f=>f.memoizedProps.tooltip==='Privacy protections'&&f.memoizedProps.icon===${JSON.stringify(value ? 'shield.lefthalf.filled' : 'shield')});`));
};
try {
  app = await launch(resolve(process.argv[2]), { data: mkdtempSync('/tmp/ardia-site-pause-'), js: 'none', probe: true, onboarded: true,
    switches: '--host-resolver-rules=MAP ardia-fixture.example.org 127.0.0.1', session: session({ tabs: [{ id: 'first', url: 'about:blank' }] }) });
  await until('native blocker ready', async () => (await cef('getContentBlocker()')).stats.ready);
  await cef('setContentBlockerProvider("adnauseam", true)');
  let target;
  await until('active background', async () => target = (await app.targets()).find(t => t.type === 'background_page'));
  background = await connect(target);
  await until('consent ready', () => background.eval('self.ardiaClickConsent===true && µBlock.readyToFilter'));
  await background.eval(`self.ardiaFixtureDNS=chrome.dns.resolve.bind(chrome.dns);chrome.dns.resolve=(hostname,...args)=>hostname==='ads.ardia-test.example.net'?Promise.resolve({addresses:['203.0.113.1']}):self.ardiaFixtureDNS(hostname,...args);`);
  await background.send('Network.enable');
  background.on('Network.loadingFailed', e => failures.push(e));
  background.on('Fetch.requestPaused', e => {
    requests.push(e);
    if (!hold) background.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<title>Local ad visit</title>').toString('base64') }).catch(() => {});
  });
  await background.send('Fetch.enable', { patterns: [{ urlPattern: 'https://ads.ardia-test.example.net/*' }] });
  await background.eval("µBlock.appendUserFilters('ardia-fixture.example.org##.ad-slot\\n')");
  await background.eval(`chrome.tabs.create({url:${JSON.stringify(url)},active:true})`);
  let pageTarget;
  await until('fixture page', async () => pageTarget = await app.pageTarget(url));
  page = await connect(pageTarget);
  await until('collected ad', async () => (await ads()).some(a => a.url.endsWith('ad=first')));
  await until('real visit in flight', () => requests.length > 0, 45000);
  await until('initial ad hidden', () => page.eval('Number(getComputedStyle(document.querySelector(".ad-slot")).opacity)===0'));
  const inFlight = requests[0];
  record('Active obfuscation collects a real image ad and starts a locally intercepted visit');
  await toggle(false);
  assert.equal((await state()).clicking, false);
  await until('request cancelled', () => failures.some(e => e.requestId === inFlight.networkId && e.canceled));
  record('the actual site toggle cancels the in-flight visit and shows an empty shield');
  const before = await ads();
  const count = requests.length;
  await page.send('Page.navigate', { url: url + '?ad=paused' });
  await until('paused page loaded', () => page.eval('document.readyState==="complete" && !!document.querySelector(".ad-slot")'));
  await sleep(12000);
  assert.deepEqual(await ads(), before);
  assert.equal(requests.length, count);
  assert.equal(await page.eval('Number(getComputedStyle(document.querySelector(".ad-slot")).opacity)===1'), true);
  record('paused site keeps normal content and visible ads but neither collects nor visits across scheduler ticks');
  hold = false;
  await toggle(true);
  assert.equal((await state()).clicking, true);
  await until('fresh resumed collection', async () => (await ads()).some(a => a.url.endsWith('ad=paused')));
  await until('queued and fresh visits complete', async () => (await ads()).filter(a => a.visited > 0).length === 2, 45000);
  await until('hiding restored', () => page.eval('Number(getComputedStyle(document.querySelector(".ad-slot")).opacity)===0'));
  record('re-enabling restores hiding, new collection, the cancelled queued visit, and fresh visits');
} catch (error) {
  results.push({ passed: false, error: String(error), stack: error.stack });
  console.error(error);
  console.log('ADS', await ads().catch(String), 'REQUESTS', requests.map(e => ({ url: e.request.url, networkId: e.networkId })), 'FAILURES', failures);
  process.exitCode = 1;
} finally {
  writeFileSync(join(output, 'results.json'), JSON.stringify({ results }, null, 2));
  for (const client of clients) client.close();
  if (app) await app.quit();
  server.closeAllConnections();
  await new Promise(r => server.close(r));
}
