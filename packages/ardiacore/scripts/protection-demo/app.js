const $ = id => document.getElementById(id);
const themes = [
  ['Weekend escapes', 'Travel', '↗', '#edf0fa', '#68749d'],
  ['Find your next sound', 'Music', '♫', '#f8eee5', '#a57b54'],
  ['A little more green', 'Gardens', '❧', '#e8f1e9', '#648471'],
  ['Take the scenic route', 'Outdoors', '⌁', '#f3ebf6', '#9273a0'],
  ['Made for slow mornings', 'Home', '☀', '#f8f2df', '#9b8954'],
  ['Ideas, on paper', 'Books', '▤', '#e8f1f0', '#5a8584'],
];
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const storageKey = 'ardia-take:' + location.pathname;
let baseline = Number(sessionStorage.getItem(storageKey) || 0), state, stream, adding = false, signature, frameIds = '', tracker = 'Checking';
const nodes = new Map();
const path = name => new URL(name, location.href);
$('tagged').href = location.pathname + '?utm_source=privacy-lab&fbclid=sample&keep=demo';
function marker() {
  try { $('marker').textContent = localStorage.getItem('ardia-lab-marker') ? 'Test marker saved. Close all site tabs to test “Forget”.' : 'No test marker saved.'; }
  catch { $('marker').textContent = 'Storage is unavailable in this context.'; }
}
$('storage').onclick = () => { try { localStorage.setItem('ardia-lab-marker', 'saved'); document.cookie = 'ardiaLab=present; Path=/; SameSite=Lax'; } catch {} marker(); };
marker();
function stop() { clearInterval(stream); stream = null; $('stream').textContent = 'Start a stream'; }
async function offer() {
  if (adding) return;
  adding = true;
  try {
    const response = await fetch(path('offer'), { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    await poll();
  } catch (error) { $('last-event').textContent = error.message; stop(); }
  finally { adding = false; }
}
$('add').onclick = offer;
$('stream').onclick = () => { if (stream) return stop(); offer(); stream = setInterval(offer, 8000); $('stream').textContent = 'Pause stream'; };
$('clear').onclick = () => {
  stop(); baseline = state?.offers.at(-1)?.id ?? baseline; sessionStorage.setItem(storageKey, baseline);
  nodes.clear(); $('cards').replaceChildren();
  $('last-event').textContent = 'Fresh display. Saved ads remain in the vault.';
  if (state) render(state);
};
function setFrame(offers, force = false) {
  const ids = offers.map(a => a.id).join(',');
  if (!force && ids === frameIds) return;
  frameIds = ids;
  $('samples').src = path('feed') + '?ids=' + encodeURIComponent(ids);
}
function hidden(id) {
  const element = $('samples').contentDocument?.getElementById('sample-' + id);
  if (!element) return false;
  const style = $('samples').contentWindow.getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
}
function probeTracker() {
  tracker = 'Checking';
  const script = document.createElement('script');
  script.src = path('tracker.js') + '?run=' + Date.now();
  script.onload = () => { tracker = 'Allowed'; script.remove(); };
  script.onerror = () => { tracker = 'Blocked'; script.remove(); };
  document.body.append(script);
}
function protection(title, value, detail, tone = '') {
  return '<div class="protection"><div><strong>' + escape(title) + '</strong><span class="value ' + tone + '">' + escape(value) + '</span></div><p>' + escape(detail) + '</p></div>';
}
function render(s) {
  const live = s.connected && s.blocker?.ready && Date.now() - s.sampledAt < 8000;
  const offers = s.offers.filter(o => o.id > baseline);
  const p = s.privacy || {};
  const active = s.blocker?.provider === 'adnauseam';
  document.body.classList.toggle('online', !!live);
  document.body.classList.toggle('active', live && active);
  document.body.classList.toggle('paused', live && !p.blocking);
  $('connection').textContent = live ? 'Live · Ardia default profile' : 'Disconnected · readings paused';
  $('mode').textContent = !live ? 'Waiting for the browser' : !p.blocking ? 'Site protection paused' : active ? 'Active obfuscation' : 'Standard protection';
  $('mode-detail').textContent = !live ? 'No current protection claims while the connection is unavailable.' : !p.blocking ? 'Collection and background visits are stopped for this site.' : active && !p.clicking ? 'Active mode is selected, but background clicking is off. Check Settings → Privacy.' : active ? 'Ads are hidden, collected locally and visited in the background.' : 'Ads stay blocked. New collection and background clicking are stopped.';
  $('site-status').textContent = !live ? 'Reconnecting' : p.blocking ? 'Protection on' : 'Protection off';
  $('add').disabled = $('stream').disabled = !live;
  if (!live) stop();
  const nextSignature = live ? [s.blocker.provider, p.blocking].join(':') : signature;
  if (live && signature !== nextSignature) { setFrame(offers, true); probeTracker(); signature = nextSignature; }
  else if (live) setFrame(offers);
  const byId = new Map((s.ads || []).map(a => [a.id, a]));
  let hiddenCount = 0, collected = 0, clicked = 0;
  for (const offer of offers) {
    const ad = byId.get(offer.id), isHidden = hidden(offer.id), completed = ad?.visitedAt > 0 && ad?.interceptedAt > 0;
    if (isHidden) hiddenCount++;
    if (ad) collected++;
    if (completed) clicked++;
    let card = nodes.get(offer.id);
    if (!card) {
      const [name, category, symbol, tint, ink] = themes[(offer.id - baseline - 1) % themes.length];
      card = document.createElement('article'); card.className = 'card'; card.dataset.id = offer.id;
      card.innerHTML = '<div class="creative" style="--tint:' + tint + ';--ink:' + ink + '"><span class="symbol" aria-hidden="true">' + symbol + '</span><div><small>Sample ' + String(offer.id - baseline).padStart(2, '0') + ' / ' + category + '</small><strong>' + name + '</strong></div></div><div class="stages"></div>';
      nodes.set(offer.id, card); $('cards').prepend(card);
    }
    card.classList.toggle('completed', completed);
    const clickLabel = completed ? '✓ Clicked' : !live ? 'Status paused' : !p.clicking ? 'Clicks off' : ad?.noVisit || ad?.dnt ? 'Not eligible' : ad?.attemptedAt > 0 ? 'Visiting…' : ad ? 'Queued' : 'Not collected';
    card.querySelector('.stages').innerHTML = '<span class="' + (isHidden ? 'yes' : '') + '">' + (isHidden ? '✓ Hidden' : 'Visible') + '</span><span class="' + (ad ? 'yes' : '') + '">' + (ad ? '✓ Collected' : 'Not collected') + '</span><span class="' + (completed ? 'clicked' : '') + '">' + clickLabel + '</span>';
    card.title = completed ? 'Completed at ' + new Date(ad.visitedAt).toLocaleTimeString() + ' · request intercepted locally' : 'Added at ' + new Date(offer.offeredAt).toLocaleTimeString();
  }
  for (const [id, node] of nodes) if (!offers.some(o => o.id === id)) { node.remove(); nodes.delete(id); }
  $('empty').hidden = offers.length > 0;
  for (const [id, value] of Object.entries({ offered: offers.length, hidden: hiddenCount, collected, clicked })) $(id).textContent = value;
  if (!live) $('last-event').textContent = 'Connection lost. Historical results remain visible.';
  else if (!p.blocking) $('last-event').textContent = 'Site paused. New samples are not collected or clicked.';
  else if (!active) $('last-event').textContent = 'Standard is blocking. Collection and clicks remain stopped.';
  else if (offers.length && !clicked) $('last-event').textContent = p.clicking ? 'Waiting for the real scheduler. The first visit can take a minute.' : 'Clicking is off. Switch to Standard, then Active obfuscation to confirm again.';
  else if (clicked) $('last-event').textContent = 'Background click completed · sample destination intercepted locally.';
  else $('last-event').textContent = 'Ready for a new take. Add a sample ad to begin.';
  if (!live) { $('protections').innerHTML = protection('Browser connection', 'Unavailable', 'Reconnect the isolated demo to read protection settings.'); return; }
  const gpc = s.gpcHeader && navigator.globalPrivacyControl === true;
  const clean = p.blocking && p.cleanLinks && !p.cleanExcepted;
  const cleaned = new URLSearchParams(location.search).get('keep') === 'demo' && !/[?&](utm_source|fbclid)=/.test(location.search);
  const cname = p.blocking && p.cname && p.cnameAvailable && !p.cnameExcepted;
  $('protections').innerHTML = [
    protection('Ads & trackers', tracker === 'Checking' ? 'Checking' : tracker + ' · test', 'One synthetic tracker request, tested on this page.', tracker === 'Blocked' ? 'on' : 'off'),
    protection('Global Privacy Control', gpc ? 'Verified on' : 'Not sent', 'HTTP header + navigator signal. A privacy preference.', gpc ? 'on' : 'off'),
    protection('Disguised trackers', !p.blocking ? 'Paused for site' : cname ? 'On · setting' : 'Off / unavailable', 'CNAME uncloaking. DNS aliases are not tested here.', cname ? 'on' : 'off'),
    protection('Clean navigation links', !p.blocking ? 'Paused for site' : clean ? cleaned ? 'Verified on link' : 'On · setting' : 'Off · setting', 'Removes known tracking tags. Try the link below.', clean ? 'on' : 'off'),
    protection('Malware filter lists', !p.blocking ? 'Paused for site' : s.blocker.securityLists > 0 ? 'Enabled · setting' : 'Not enabled', 'Filter-list protection; not a malware safety test.', p.blocking && s.blocker.securityLists > 0 ? 'on' : 'off'),
    protection('Forget after closing', p.forget ? 'On · setting' : 'Off · optional', 'Enable in the shield, then close every tab for this site.', p.forget ? 'on' : ''),
  ].join('');
  $('build').textContent = 'Running engine: ' + (s.blocker.version || 'Ardia Blocker') + '. Dashboard totals include only this take, not your browsing history.';
}
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try { state = await fetch(path('state'), { signal: AbortSignal.timeout(3500) }).then(r => r.json()); render(state); }
  catch { if (state) render({ ...state, connected: false }); else $('mode').textContent = 'Test server unavailable'; }
  finally { polling = false; }
}
poll(); setInterval(poll, 1000);
$('samples').onload = () => { if (state) render(state); };
