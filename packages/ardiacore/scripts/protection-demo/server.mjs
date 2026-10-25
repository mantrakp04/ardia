import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { attach, devtools } from '../../../../scripts/lib/instance.mjs';

const data = process.argv[2];
if (!data) throw Error('Usage: node packages/ardiacore/scripts/protection-demo/server.mjs <isolated instance directory>');
const app = attach(data);
if (!/^(ardia-|ac-)/.test(resolve(data).split('/').at(-1))) throw Error('Use an isolated Ardia test profile.');
const token = randomUUID();
const prefix = '/' + token + '/';
const slotClass = 'ardia-lab-slot-' + token;
const host = 'ads.ardia-demo.example.org';
const offers = [], visits = new Map(), ownedRules = new Set();
let background, timer, updating = false, closed = false, status = { connected: false }, url;
const assets = { '': ['index.html', 'text/html'], 'app.js': ['app.js', 'text/javascript'], 'style.css': ['style.css', 'text/css'] };
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers.host !== new URL(url).host || (req.headers.origin && req.headers.origin !== new URL(url).origin)) { res.writeHead(403).end(); return; }
  const target = new URL(req.url, url);
  if (!target.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
  const path = target.pathname.slice(prefix.length);
  const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (path === 'state') return json({ ...status, sampledAt: status.sampledAt ?? null, offers, gpcHeader: req.headers['sec-gpc'] === '1' });
  if (path === 'offer' && req.method === 'POST') {
    if (!status.connected || offers.length >= 120) { res.statusCode = 409; return json({ error: 'Reconnect the demo, or start a new recording session after 120 ads.' }); }
    const id = offers.length + 1;
    const offer = { id, offeredAt: Date.now(), mode: status.blocker?.provider, blocking: status.privacy?.blocking, destination: 'https://' + host + '/visit?session=' + token + '&ad=' + id };
    offers.push(offer);
    return json(offer);
  }
  if (path === 'tracker.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('window.labTrackerLoaded = true;'); return; }
  if (path === 'feed') {
    const ids = new Set((target.searchParams.get('ids') || '').split(',').map(Number));
    const shown = offers.filter(o => ids.has(o.id));
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Local sample ads</title><body>' + shown.map(o => '<div class="' + slotClass + '" id="sample-' + o.id + '" style="width:300px;height:250px"><a href="' + o.destination.replaceAll('&', '&amp;') + '"><img src="banner.svg?ad=' + o.id + '" width="300" height="250" alt="Sample ad ' + o.id + '"></a></div>').join('') + '</body></html>'); return;
  }
  if (path === 'banner.svg') {
    const id = Number(target.searchParams.get('ad')) || 1;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="250"><rect width="300" height="250" fill="#477166"/><text x="24" y="110" fill="white" font-family="sans-serif" font-size="24">Sample ad ' + id + '</text><text x="24" y="146" fill="white" font-family="sans-serif" font-size="15">Controlled local test</text></svg>'); return;
  }
  if (assets[path]) { const [file, type] = assets[path]; res.setHeader('Content-Type', type); res.end(readFileSync(join(import.meta.dirname, file))); return; }
  res.writeHead(404).end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
url = 'http://127.0.0.1:' + server.address().port + prefix;
const rule = '|'+url+'tracker.js$script\n127.0.0.1##.' + slotClass + '\n';
async function update() {
  if (updating || closed) return;
  updating = true;
  try {
    if (!app.stillOwned()) throw Error('The test browser has closed.');
    const targets = await fetch('http://127.0.0.1:' + app.port + '/json', { signal: AbortSignal.timeout(3000) }).then(r => r.json());
    const backgrounds = targets.filter(t => t.type === 'background_page' && t.url.includes('fajbdaomknpkicfjcpipdmcpoamdmilh'));
    let target = backgrounds.find(t => background && !background.closed && t.id === background.target.id);
    if (!target) {
      const urls = await app.eval('return Object.values(ac.store.getState().tabs).filter(t=>t.profileId==="default").map(t=>t.url);', { timeout: 4000 });
      const matches = [];
      for (const candidate of backgrounds) {
        const probe = await devtools(candidate);
        try {
          const tabs = await probe.eval('chrome.tabs.query({}).then(t=>t.filter(t=>!t.incognito).map(t=>t.url))');
          if (tabs.some(t => t === url || urls.includes(t))) matches.push(candidate);
        } finally { probe.close(); }
      }
      if (matches.length !== 1) throw Error('Open a unique page in the demo’s default profile before starting the lab.');
      target = matches[0];
    }
    if (!target) throw Error('Waiting for the blocker to restart.');
    if (!background || background.closed || background.target.id !== target.id) {
      background?.close();
      const client = background = await devtools(target);
      client.on('Fetch.requestPaused', async event => {
        try {
        const target = new URL(event.request.url);
        const id = Number(target.searchParams.get('ad'));
        if (target.hostname !== host || target.searchParams.get('session') !== token || !offers.some(o => o.id === id)) {
          await client.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); return;
        }
        await client.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<title>Local sample destination</title>').toString('base64') });
        visits.set(id, Date.now());
        } catch {}
      });
      await client.send('Fetch.enable', { patterns: [{ urlPattern: 'https://' + host + '/*' }] });
      await client.eval('if(!self.ardiaRecordingDNS){self.ardiaRecordingDNS=chrome.dns.resolve.bind(chrome.dns);chrome.dns.resolve=(name,...args)=>name===' + JSON.stringify(host) + '?Promise.resolve({addresses:["203.0.113.1"]}):self.ardiaRecordingDNS(name,...args);}');
      const existing = await client.eval('µBlock.loadUserFilters().then(r=>r.content || "")');
      for (const line of rule.trim().split('\n')) if (!existing.split('\n').includes(line)) ownedRules.add(line);
      await client.eval('µBlock.appendUserFilters(' + JSON.stringify(rule) + ')');
    }
    const snapshot = await background.eval('(async()=>{const privacy=await ardiaPrivacy.state(' + JSON.stringify(url) + ');const selected=new Set(µBlock.selectedFilterLists);const securityLists=Object.entries(µBlock.availableFilterLists).filter(([id,list])=>selected.has(id)&&(id==="ublock-badware"||list.group==="malware")).length;const ads=adnauseam.adlist().filter(a=>a.targetUrl.includes(' + JSON.stringify(token) + ')).map(a=>({id:Number(new URL(a.targetUrl).searchParams.get("ad")),collectedAt:a.foundTs,visitedAt:a.visitedTs,attemptedAt:a.attemptedTs,attempts:a.attempts,noVisit:!!a.noVisit,dnt:!!a.dntAllowed}));return {privacy,ads,blocker:{provider:privacy.mode,ready:privacy.ready,version:"Ardia Blocker " + chrome.runtime.getManifest().version,securityLists}}})()');
    const unique = new Map();
    for (const ad of snapshot.ads) {
      if (!offers.some(offer => offer.id === ad.id)) continue;
      const previous = unique.get(ad.id);
      unique.set(ad.id, previous ? { ...ad, collectedAt: Math.min(previous.collectedAt, ad.collectedAt), visitedAt: Math.max(previous.visitedAt, ad.visitedAt), attemptedAt: Math.max(previous.attemptedAt, ad.attemptedAt), noVisit: previous.noVisit && ad.noVisit, dnt: previous.dnt && ad.dnt } : ad);
    }
    status = { ...snapshot, connected: true, sampledAt: Date.now(), ads: [...unique.values()].map(a => ({ ...a, interceptedAt: visits.get(a.id) ?? null })), intercepted: visits.size };
  } catch (error) { status = { ...status, connected: false, error: error.message }; }
  finally { updating = false; }
}
await update();
if (!status.connected) { console.error(status.error); await stop(1); }
timer = setInterval(update, 1000);
await background.eval('chrome.tabs.create({url:' + JSON.stringify(url) + ',active:true})');
writeFileSync(join(app.data, 'protection-demo.json'), JSON.stringify({ url, token, pid: process.pid, port: app.port }, null, 2));
console.log(JSON.stringify({ url, data: app.data, pid: process.pid }));
async function stop(code = 0) {
  if (closed) return;
  closed = true;
  clearInterval(timer);
  await background?.eval('if(self.ardiaRecordingDNS){chrome.dns.resolve=self.ardiaRecordingDNS;delete self.ardiaRecordingDNS;}').catch(() => {});
  if (ownedRules.size) await background?.eval('µBlock.loadUserFilters().then(async r=>{if(r.error) return;const own=new Set(' + JSON.stringify([...ownedRules]) + ');await µBlock.saveUserFilters(r.content.split("\\n").filter(line=>!own.has(line)).join("\\n"));await µBlock.loadFilterLists();})').catch(() => {});
  background?.close();
  server.closeAllConnections();
  server.close();
  process.exit(code);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
