import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { devtools, launch, session, sleep } from '../../../scripts/lib/instance.mjs';

const application = resolve(process.argv[2]);
assert.ok(!application.startsWith('/Applications/'));
assert.equal(existsSync(join(application, 'Contents/Resources/Extensions/adnauseam')), false);
const work = mkdtempSync('/tmp/ardia-unified-acceptance-');
const output = resolve('apps/browser/build-unified/acceptance');
mkdirSync(output, { recursive: true });
const id = 'fajbdaomknpkicfjcpipdmcpoamdmilh';
const results = [];
const requests = [];
const clients = [];
const routes = [];
let app, background, page;
const server = createServer((req, res) => {
  routes.push(req.url);
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/engine') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Engine switch fixture</title><h1>Normal content remains available</h1>');
  } else if (req.url === '/banner.svg') {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="250"><rect width="300" height="250" fill="blue"/><text x="20" y="80" fill="white">Local test ad</text></svg>');
  } else if (req.url.startsWith('/pagead/ads')) {
    res.setHeader('Content-Type', 'text/javascript');
    res.end('window.adLoaded=true');
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<title>Unified blocker fixture</title><h1>Normal content remains available</h1><script>window.normalLoaded=true</script><script src="http://pagead2.googlesyndication.com:${server.address().port}/pagead/ads?client=fixture"></script><div class="ad-slot"><a href="https://ads.ardia-test.example.net/click?${req.url.includes('private') ? 'private' : 'normal'}"><img src="/banner.svg" width="300" height="250"></a></div>`);
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://ardia-fixture.example.org:${server.address().port}/`;
const until = async (label, read, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
};
const connect = async target => { const c = await devtools(target); clients.push(c); return c; };
const cef = code => app.eval(`return expo.modules.ArdiaCEF.${code};`, { timeout: 60000 });
const state = () => cef('getContentBlocker()');
const record = name => { results.push({ name, passed: true }); console.log('PASS', name); };
const bindBackground = async () => {
  background = await connect(await until('blocker background', async () => (await app.targets()).find(t => t.type === 'background_page' && t.url.includes(id))));
  await until('engine ready', () => background.eval('typeof µBlock !== "undefined" && µBlock.readyToFilter === true'));
  background.on('Fetch.requestPaused', event => {
    requests.push(event.request.url);
    background.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<title>Local intercepted ad visit</title>').toString('base64') }).catch(() => {});
  });
  await background.send('Fetch.enable', { patterns: [{ urlPattern: 'https://ads.ardia-test.example.net/*' }] });
  await background.eval(`if (chrome.dns?.resolve && !self.ardiaFixtureDNS) {
    self.ardiaFixtureDNS = chrome.dns.resolve.bind(chrome.dns);
    chrome.dns.resolve = (hostname, ...args) => hostname === 'ads.ardia-test.example.net'
      ? Promise.resolve({ addresses: ['203.0.113.1'] }) : self.ardiaFixtureDNS(hostname, ...args);
  }`);
};
const ads = () => background.eval('adnauseam.adlist().map(a=>({target:a.targetUrl,visited:a.visitedTs,private:a.private}))');
try {
  app = await launch(application, { data: join(work, 'data'), js: 'none', probe: true, onboarded: true,
    switches: '--host-resolver-rules=MAP ardia-fixture.example.org 127.0.0.1, MAP pagead2.googlesyndication.com 127.0.0.1',
    session: session({ tabs: [{ id: 'first', url: 'about:blank' }] }) });
  console.log('PROFILE', app.data);
  await until('native readiness', async () => (await state()).stats.ready);
  await bindBackground();
  assert.equal((await state()).provider, 'ublock');
  assert.equal((await state()).clickAds, false);
  assert.equal(await background.eval('self.ardiaClickConsent'), false);
  assert.equal((await app.targets()).filter(t => t.type === 'background_page' && /fajbdaom|kmggpp/.test(t.url)).length, 1);
  record('one unified component, Standard default, native consent closed');

  await background.eval("µBlock.appendUserFilters('ardia-fixture.example.org##.ad-slot\\n')");
  await background.eval(`chrome.tabs.create({url:${JSON.stringify(url)},active:true})`);
  page = await connect(await until('fixture', () => app.pageTarget(url)));
  await until('ordinary content', () => page.eval('window.normalLoaded === true'));
  await sleep(1500);
  assert.equal(await page.eval('window.adLoaded === true'), false);
  assert.equal(routes.some(r => r.startsWith('/pagead/ads')), false);
  assert.equal((await ads()).length, 0);
  assert.equal(requests.length, 0);
  record('Standard blocks a real ad request and performs no collection or visits');
  const mainTabId = await app.eval(`return Object.values(ac.store.getState().tabs).find(t=>t.url===${JSON.stringify(url)})?.id;`);
  assert.ok(mainTabId);
  await app.eval(`ac.pageState.setState(s=>({popover:{...s.popover,[${JSON.stringify(mainTabId)}]:"protection"}}));return true;`);
  await until('popover shows the real blocked request', () => app.eval('return acPerf.findFibers("Metric").some(f=>f.memoizedProps.title==="Ads & trackers blocked"&&f.memoizedProps.value>0);'));
  await app.eval(`ac.pageState.setState(s=>({popover:{...s.popover,[${JSON.stringify(mainTabId)}]:null}}));return true;`);
  record('protection popover reports the native blocked-request counter');


  await assert.rejects(cef('setContentBlockerProvider("adnauseam", false)'), /consent/);
  assert.equal((await state()).provider, 'ublock');
  record('native API rejects active obfuscation without consent');

  const pid = app.pid;
  await cef('setContentBlockerProvider("adnauseam", true)');
  assert.equal(app.pid, pid);
  await bindBackground();
  await until('consented active mode', () => background.eval('self.ardiaClickConsent === true'));
  await page.send('Page.navigate', { url });
  await until('real image ad collected', async () => (await ads()).some(a => a.target.includes('?normal')));
  await app.eval(`ac.pageState.setState(s=>({popover:{...s.popover,[${JSON.stringify(mainTabId)}]:"protection"}}));return true;`);
  await until('popover reports actual collection', () => app.eval('return acPerf.findFibers("Metric").some(f=>f.memoizedProps.title==="Ads collected"&&f.memoizedProps.value===1);'));
  await until('real scheduled visit intercepted locally', () => requests.some(r => r.includes('?normal')), 45000);
  await until('visit recorded in vault', async () => (await ads()).some(a => a.visited > 0));
  record('full AdNauseam parser collects an image ad and its scheduler visits it without browser restart');
  await until('popover updates completed clicks live', () => app.eval('return acPerf.findFibers("Metric").some(f=>f.memoizedProps.title==="Ads clicked"&&f.memoizedProps.value===1);'));
  const activity = await cef(`getPrivacySettings('',${JSON.stringify(url)})`);
  assert.deepEqual(activity.activity, { collected: 1, clicked: 1 });
  assert.deepEqual((await cef('getPrivacySettings("", "https://unrelated.example.com/")')).activity, { collected: 0, clicked: 0 });
  await app.eval(`ac.pageState.setState(s=>({popover:{...s.popover,[${JSON.stringify(mainTabId)}]:null}}));return true;`);
  record('protection popover shows live site collection and completed visits without mixing other sites');


  await background.eval(`chrome.windows.create({url:${JSON.stringify(url + '?private')},incognito:true,focused:false})`);
  const privatePage = await connect(await until('private fixture', () => app.pageTarget(url + '?private')));
  await until('private page ready', () => privatePage.eval('window.normalLoaded === true'));
  await sleep(1500);
  assert.equal((await ads()).some(a => a.target.includes('?private')), false);
  assert.equal(requests.some(r => r.includes('?private')), false);
  const privateTabId = await app.eval(`return Object.values(ac.store.getState().tabs).find(t=>t.url===${JSON.stringify(url + '?private')})?.id;`);
  assert.ok(privateTabId);
  await app.eval(`ac.pageState.setState(s=>({popover:{...s.popover,[${JSON.stringify(privateTabId)}]:"protection"}}));return true;`);
  await until('private protection popover', () => app.eval('return acPerf.findFibers("ProtectionPanel").length>0;'));
  await sleep(400);
  assert.equal(await app.eval('return acPerf.findFibers("Metric").some(f=>f.memoizedProps.title==="Ads clicked"||f.memoizedProps.title==="Ads collected");'), false);
  await privatePage.send('Page.close');
  record('real private window does not collect or visit ads');

  await cef('setContentBlockerEnabled(false)');
  assert.equal(await background.eval('self.ardiaClickConsent'), false);
  await cef('setContentBlockerEnabled(true)');
  await until('resume consent', () => background.eval('self.ardiaClickConsent === true'));
  record('global pause closes the gate and resume reapplies consent');

  await background.eval('location.reload(); true').catch(() => {});
  await sleep(1200);
  await bindBackground();
  await until('consent restored after background restart', () => background.eval('self.ardiaClickConsent === true'));
  assert.ok((await ads()).length);
  record('background restart restores consent and the persistent vault');

  await cef('setContentBlockerProvider("ublock", false)');
  await bindBackground();
  assert.equal(await background.eval('self.ardiaClickConsent'), false);
  assert.equal((await state()).clickAds, false);
  assert.ok((await ads()).length);
  const standardPrivacy = await cef(`getPrivacySettings('',${JSON.stringify(url)})`);
  assert.equal(standardPrivacy.clicking, false);
  assert.deepEqual(standardPrivacy.activity, { collected: 1, clicked: 1 });
  record('returning to Standard stops obfuscation and retains the local vault');

  const listsBeforeOnboarding = (await state()).lists;
  await app.eval('ac.onboarding.startOnboarding("w1", "searchPrivacy"); ac.onboarding.useOnboarding.getState().setExtras({share:false}); ac.onboarding.useOnboarding.getState().go("searchPrivacy", 2); return true;');
  await until('search privacy step', () => app.eval('return acPerf.findFibers("SearchPrivacyStep").length > 0;'));
  await sleep(300);
  await app.eval('return acPerf.findFibers("StepActions")[0].memoizedProps.onContinue();');
  assert.equal(await app.eval('return ac.onboarding.useOnboarding.getState().step;'), 'blocker');
  assert.deepEqual((await state()).lists, listsBeforeOnboarding);
  assert.equal((await state()).clickAds, false);
  record('latest onboarding advances from privacy questions to protection without changing filters or consent');
  await sleep(1000);
  const rows = await app.eval('return acPerf.findFibers("CheckRow").map(f=>({title:f.memoizedProps.title, selected:f.memoizedProps.value, role:f.memoizedProps.role}));');
  assert.ok(rows.some(r => r.title === 'Standard' && r.selected && r.role === 'radio'), JSON.stringify(rows));
  assert.ok(rows.some(r => r.title === 'Active obfuscation' && !r.selected), JSON.stringify(rows));
  record('real onboarding renders both modes with Standard selected');
  await app.eval('return acPerf.findFibers("PrimaryButton").find(f=>f.memoizedProps.title==="Continue").memoizedProps.onPress();');
  assert.equal(await app.eval('return ac.onboarding.useOnboarding.getState().step;'), 'pins');
  assert.equal((await state()).provider, 'ublock');
  assert.equal((await state()).clickAds, false);
  record('Standard continues to the latest pinned-app step without granting consent');
  await app.eval('ac.onboarding.useOnboarding.setState({windowId:null}); ac.openSettings("privacy"); return true;');
  await sleep(1000);
  const titles = await app.eval('return acPerf.findFibers("Row").map(f=>f.memoizedProps.title).filter(t=>typeof t==="string");');
  assert.ok(titles.includes('Ad Vault'), JSON.stringify(titles));
  record('Settings renders the unified mode selector and Ad Vault');
  const vaultURL = `chrome-extension://${id}/vault.html`;
  await background.eval(`chrome.tabs.create({url:${JSON.stringify(vaultURL)},active:true})`);
  const vault = await connect(await until('vault tab', () => app.pageTarget(vaultURL)));
  await until('vault UI loaded', () => vault.eval('document.readyState === "complete" && !!document.querySelector("#container .item")'));
  await until('vault layout finished', () => vault.eval('getComputedStyle(document.querySelector("#loading-img")).display === "none" && Number(getComputedStyle(document.querySelector("#container")).opacity) === 1'));
  assert.ok(await vault.eval('document.querySelector("#export").textContent.trim().length > 0'), 'vault controls have translated labels');
  await sleep(300);
  const capture = await vault.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(output, 'vault.png'), Buffer.from(capture.data, 'base64'));
  record('full Ad Vault renders from the single bundled component');
  const preferencesURL = `chrome-extension://${id}/dashboard.html#options.html`;
  await background.eval(`chrome.tabs.create({url:${JSON.stringify(preferencesURL)},active:true})`);
  const preferences = await connect(await until('preferences tab', () => app.pageTarget(preferencesURL)));
  await until('mode-aware AdNauseam preferences', () => preferences.eval('document.querySelector("iframe")?.contentDocument?.body?.innerText.includes("Ardia Settings")'));
  assert.equal(await preferences.eval('getComputedStyle(document.querySelector("iframe").contentDocument.querySelector("#clickingAds").closest(".switch")).display'), 'none');
  record('full preferences load with Ardia owning the clicking mode');

  const engineTab = await app.eval(`return ac.store.getState().newTab("w1", {url:${JSON.stringify(`http://127.0.0.1:${server.address().port}/engine`)}});`);
  const showSiteControls = async () => {
    await app.eval(`ac.pageState.setState(s=>({popover:{...s.popover,[${JSON.stringify(engineTab)}]:"siteControls"}}));return true;`);
    await until('engine site controls', () => app.eval(`return acPerf.findFibers("SiteControlsPanel").some(f=>f.memoizedProps.tabId===${JSON.stringify(engineTab)});`));
  };
  const switchEngine = async title => {
    await showSiteControls();
    await app.eval('acPerf.findFibers("MoreButton")[0].memoizedProps.onPress(); return true;');
    await until('engine switch action', () => app.eval(`return acPerf.findFibers("PopoverRow").some(f=>f.memoizedProps.title===${JSON.stringify(title)});`));
    await app.eval(`acPerf.findFibers("PopoverRow").find(f=>f.memoizedProps.title===${JSON.stringify(title)}).memoizedProps.onPress(); return true;`);
  };
  await switchEngine('Open Page in WebKit');
  await until('page switched to WebKit', () => app.eval(`return ac.store.getState().tabs[${JSON.stringify(engineTab)}]?.engine==="webkit";`));
  await until('ordinary content in WebKit', () => app.eval(`return ac.webviews.get(${JSON.stringify(engineTab)})?.evaluate('post("result", JSON.stringify(document.querySelector("h1")?.textContent === "Normal content remains available"))');`));
  await showSiteControls();
  assert.equal(await app.eval('return acPerf.findFibers("SettingRow").some(f=>f.memoizedProps.title==="Privacy protections");'), false);
  assert.ok(await app.eval('return acPerf.findFibers("SettingRow").some(f=>f.memoizedProps.title==="Block Ads & Trackers"&&f.memoizedProps.value==="Chromium only for now"&&!f.memoizedProps.onPress);'));
  await app.eval(`ac.pageState.setState(s=>({popover:{...s.popover,[${JSON.stringify(engineTab)}]:"protection"}}));return true;`);
  await sleep(500);
  assert.equal(await app.eval(`return ac.pageState.getState().popover[${JSON.stringify(engineTab)}];`), null);
  assert.equal(await app.eval('return acPerf.findFibers("ProtectionPanel").length;'), 0);
  assert.equal(await app.eval('return acPerf.findFibers("ChromiumProtectionButton").length;'), 0);
  await switchEngine('Open Page in Chromium');
  await until('page switched to Chromium', () => app.eval(`return ac.store.getState().tabs[${JSON.stringify(engineTab)}]?.engine==="chromium";`));
  await app.eval(`ac.pageState.setState(s=>({popover:{...s.popover,[${JSON.stringify(engineTab)}]:"protection"}}));return true;`);
  await until('Chromium protections return', () => app.eval('return acPerf.findFibers("ProtectionPanel").length>0 && acPerf.findFibers("ChromiumProtectionButton").length>0;'));
  await app.eval(`ac.pageState.setState(s=>({popover:{...s.popover,[${JSON.stringify(engineTab)}]:null}}));return true;`);
  record('switching WebKit and Chromium hides unsupported protections and restores the shield');

  await cef('setContentBlockerProvider("adnauseam", true)');
  await app.eval('const profileId = ac.store.getState().createProfile({name:"Work"}); return ac.store.getState().createWindow({profileId});');
  await until('two profile backgrounds', async () => (await app.targets()).filter(t=>t.type==='background_page' && t.url.includes(id)).length===2);
  const allGates = async expected => {
    for (const target of (await app.targets()).filter(t=>t.type==='background_page' && t.url.includes(id))) {
      const client = await connect(target);
      await until('profile consent matches', async () => (await client.eval('self.ardiaClickConsent === true'))===expected);
    }
  };
  await allGates(true);
  await cef('setContentBlockerProvider("ublock", false)');
  await allGates(false);
  record('new profiles inherit active consent and Standard revokes it in every profile');

} catch (error) {
  console.log('DIAGNOSTICS', await background?.eval('({gate:self.ardiaClickConsent,prefs:adnauseam.contentPrefs("ardia-fixture.example.org"),tabs:[...self.ardiaPublicTabs],ads:adnauseam.adlist(),filters:µBlock.selectedFilterLists})').catch(String));
  console.log('PAGE', await page?.eval('({url:location.href,dom:document.body.innerHTML,display:getComputedStyle(document.querySelector(".ad-slot")).display})').catch(String));
  results.push({ passed: false, error: String(error), stack: error.stack });
  console.error(error);
  process.exitCode = 1;
} finally {
  writeFileSync(join(output, 'results.json'), JSON.stringify({ work, results, requests }, null, 2));
  for (const client of clients) client.close();
  if (app) await app.quit();
  server.closeAllConnections();
  await new Promise(r => server.close(r));
}
