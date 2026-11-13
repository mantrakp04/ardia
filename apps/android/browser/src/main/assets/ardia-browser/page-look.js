(() => {
  const links = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="shortcut icon"]')];
  const scored = links.filter(l => l.href).map(l => {
    const rel = (l.getAttribute('rel') || '').toLowerCase();
    const size = parseInt((l.getAttribute('sizes') || '').split('x')[0], 10) || (rel.includes('apple') ? 180 : 16);
    const svg = (l.getAttribute('type') || '').includes('svg') || l.href.endsWith('.svg');
    return { href: l.href, score: svg ? 0 : Math.abs(96 - size) };
  }).sort((a, b) => a.score - b.score);
  const resolve = (value) => {
    if (!value || !document.documentElement) return null;
    const probe = document.createElement('i');
    probe.style.color = value;
    if (!probe.style.color) return null;
    probe.style.display = 'none';
    document.documentElement.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  };
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const meta = metas.find(m => { const media = m.getAttribute('media'); return media && matchMedia(media).matches; }) || metas.find(m => !m.getAttribute('media'));
  const opaque = (color) => color && !/^rgba\(.*,\s*0\)$/.test(color) && color !== 'transparent' ? color : null;
  const background = [document.body, document.documentElement].map(el => el && opaque(getComputedStyle(el).backgroundColor)).find(Boolean) || null;
  const body = document.body;
  const content = !!body && ((body.innerText || '').trim().length > 0 || !!body.querySelector('img,svg,video,canvas,picture,iframe'));
  return JSON.stringify({ icon: scored.length ? scored[0].href : null, theme: meta ? resolve(meta.getAttribute('content')) : null, background, content });
})()
