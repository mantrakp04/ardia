import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function privacyFixture() {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, method: req.method, host: req.headers.host, gpc: req.headers['sec-gpc'] });
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/echo') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ gpc: req.headers['sec-gpc'] ?? null, url: req.url, method: req.method })); return; }
    if (url.pathname === '/tracker.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('window.fixtureTrackerLoaded = true;'); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><meta charset="utf-8"><title>Ardia Privacy Lab</title><style>:root{color-scheme:dark;font-family:-apple-system,sans-serif;background:#101715;color:#edf5ef}body{max-width:850px;margin:40px auto;padding:0 25px}h1{font-size:36px;letter-spacing:-1px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}section{border:1px solid #344a3b;border-radius:18px;padding:22px;margin-bottom:18px}h2{font-size:19px;margin-top:0}p{line-height:1.5;color:#adc4b5}button,a{font:inherit;color:#b6edc7}button{background:#263b2e;border:0;padding:10px 16px;border-radius:9px;cursor:pointer}code{overflow-wrap:anywhere;color:#d6f3df}#current{font-size:13px}small{color:#9cbaa7}</style>
    <small>ARDIA BLOCKER LAB · LOCAL TESTS</small><h1>Try your privacy controls.</h1><p>Use Settings → Privacy for this profile, or open the site's controls beside the address. This page uses only local test data.</p>
    <div class="grid"><section><h2>Global Privacy Control</h2><p>Navigation header: <b id="header">${req.headers['sec-gpc'] === '1' ? 'Sec-GPC: 1' : 'Not sent'}</b></p><p>Page signal: <b id="gpc"></b><br>Worker signal: <b id="worker">Checking…</b></p><button onclick="location.reload()">Refresh signals</button></section>
    <section><h2>Remember, then forget</h2><p id="data"></p><button id="remember">Save test data</button> <a href="/" target="_blank">Open a second tab</a><p>Enable “Forget after closing” in site controls. Close all tabs for this site, wait a few seconds, then return here. The saved marker should be gone.</p></section></div>
    <section><h2>Clean links without changing sensitive links</h2><p><a id="tracking" href="/landing?utm_source=privacy-demo&fbclid=test&keep=hello%20world">Open a tagged link</a> — only <code>keep=hello%20world</code> should remain.</p><p><a id="signed" href="/checkout?utm_source=privacy-demo&signature=example">Open a mock signed checkout link</a> — every parameter should remain.</p><form method="post" action="/landing?utm_source=form"><button>Send a POST form</button> <small>Its URL is left unchanged.</small></form><p id="current"></p></section>
    <section><h2>Disguised trackers and per-site controls</h2><p>“Uncloak disguised trackers” checks DNS aliases against blocking rules. The site panel shows availability and exceptions. This local page does not impersonate a real tracking network.</p></section>
    <script>const signal=v=>v===true?'On':v===false?'Off':'Off (not exposed)';document.getElementById('gpc').textContent=signal(navigator.globalPrivacyControl);document.getElementById('current').textContent='Current URL: '+location.href;
    function display(){document.getElementById('data').textContent='Storage: '+(localStorage.getItem('privacyDemo')||'empty')+' · Cookie: '+(document.cookie.includes('privacyDemo=')?'present':'empty')}
    document.getElementById('remember').onclick=()=>{localStorage.setItem('privacyDemo','saved locally');document.cookie='privacyDemo=present; Path=/; SameSite=Lax';display()};display();
    const blob=new Blob(["fetch("+JSON.stringify(location.origin+'/echo')+").then(r=>r.json()).then(r=>postMessage({signal:navigator.globalPrivacyControl,header:r.gpc}))"],{type:'text/javascript'});const workerURL=URL.createObjectURL(blob);const worker=new Worker(workerURL);worker.onmessage=e=>{document.getElementById('worker').textContent=signal(e.data.signal)+' · header '+String(e.data.header);worker.terminate();URL.revokeObjectURL(workerURL)};
    </script>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, requests, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/` };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await privacyFixture();
  console.log(fixture.url);
}
