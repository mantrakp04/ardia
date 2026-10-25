import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { devtools, launch, session, sleep } from '../../../scripts/lib/instance.mjs';

const application = resolve(process.argv[2]);
assert.ok(!application.startsWith('/Applications/'));
const hits = [];
const server = createServer((req, res) => {
  hits.push(req.url);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(req.url.endsWith('.js') ? 'window.adLoaded=true' : '<title>Counter fixture</title><h1>Ordinary content</h1>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/counter`;
const clients = [];
let app;
const until = async (label, read) => {
  for (const end = Date.now() + 30000; Date.now() < end; await sleep(100)) {
    const value = await read();
    if (value) return value;
  }
  throw Error(`Timed out: ${label}`);
};
const connect = async target => { const c = await devtools(target); clients.push(c); return c; };
const stats = id => app.eval(`return ac.webviews.get(${JSON.stringify(id)})?.getContentBlockerStats();`);
try {
  app = await launch(application, { data: mkdtempSync('/tmp/ardia-counter-test-'), js: 'none', probe: true, onboarded: true,
    session: session({ tabs: [{ id: 'first', url: 'about:blank' }] }) });
  await until('blocker ready', async () => (await app.eval('return expo.modules.ArdiaCEF.getContentBlocker()')).stats.ready);
  const bg = await connect((await app.targets()).find(t => t.type === 'background_page'));
  const filters = `|${url}/blocked.js$script\n|${url}/replacement.js$script,redirect=noop.js\n`;
  await bg.eval(`µBlock.appendUserFilters(${JSON.stringify(filters)})`);
  const first = await app.eval(`return ac.store.getState().newTab('w1',{url:${JSON.stringify(url)}})`);
  const page = await connect(await until('page', () => app.pageTarget(url)));
  await until('first count', async () => (await stats(first))?.blocked === 0);
  await page.eval(`Promise.all(['blocked','replacement'].map(name=>new Promise(resolve=>{const s=document.createElement('script');s.src=${JSON.stringify(url)}+'/'+name+'.js';s.onload=()=>resolve('loaded');s.onerror=()=>resolve('blocked');document.head.append(s)})))`);
  await until('blocked and replaced requests counted', async () => (await stats(first))?.blocked === 2);
  assert.equal(hits.some(p => p.endsWith('.js')), false);
  const second = await app.eval(`return ac.store.getState().newTab('w1',{url:${JSON.stringify(url)}})`);
  await until('same URL in separate tab', async () => (await stats(second))?.blocked === 0);
  assert.equal((await stats(first)).blocked, 2);
  await app.eval(`ac.store.getState().activate(${JSON.stringify(first)});ac.pageState.setState(s=>({popover:{...s.popover,[${JSON.stringify(first)}]:'protection'}}));return true`);
  await until('rendered count includes replacement', () => app.eval('return acPerf.findFibers("Metric").some(f=>f.memoizedProps.title==="Ads & trackers blocked"&&f.memoizedProps.value===2)'));
  await app.eval(`ac.pageState.setState(s=>({popover:{...s.popover,[${JSON.stringify(first)}]:null}}));return true`);
  await page.eval('history.pushState({}, "", "#details")');
  await until('same-document navigation keeps its count', async () => { const s = await stats(first); return s?.url === url + '#details' && s.blocked === 2; });
  await bg.eval(`chrome.windows.create({url:${JSON.stringify(url + '?private')},incognito:true,focused:false})`);
  const privatePage = await connect(await until('private page', () => app.pageTarget(url + '?private')));
  const privateId = await app.eval(`return Object.values(ac.store.getState().tabs).find(t=>t.url===${JSON.stringify(url + '?private')})?.id`);
  assert.ok(privateId);
  await until('private counter ready', async () => (await stats(privateId))?.blocked === 0);
  await privatePage.eval(`new Promise(resolve=>{const s=document.createElement('script');s.src=${JSON.stringify(url + '/replacement.js')};s.onload=resolve;s.onerror=resolve;document.head.append(s)})`);
  await until('private count includes replacement', async () => (await stats(privateId))?.blocked === 1);
  assert.equal((await stats(second)).blocked, 0);
  await page.send('Page.navigate', { url: url + '?next' });
  await until('navigation resets count', async () => { const s = await stats(first); return s?.url === url + '?next' && s.blocked === 0; });
  console.log('PASS blocked and replaced requests, tab isolation, private counters, rendered shield and navigation reset');
  await app.eval('return expo.modules.ArdiaCEF.setContentBlockerProvider("adnauseam",true)', { timeout: 60000 });
  await app.eval('ac.openSettings("privacy");return true');
  await until('filter controls in active mode', () => app.eval('return acPerf.findFibers("Row").some(f=>f.memoizedProps.anchor==="privacy.filterLists"&&f.memoizedProps.title==="Filter lists")'));
  console.log('PASS filter-list controls remain available in Active obfuscation');
} finally {
  for (const c of clients) c.close();
  await app?.quit();
  await new Promise(r => server.close(r));
}
