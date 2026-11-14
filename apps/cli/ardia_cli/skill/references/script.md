# `ardia browse script` recipes

A script is one call that does what would otherwise be a command per item. It runs in a blank background page of
its own, outside the page it drives: there's no `document` or `window`. Every `page.*` call is an `ardia browse`
command on this session, with the same tab, refs, rules and change reports. `ardia browse script --help` lists every
call. Selectors are CSS, `@eN`, `text=…` or `xpath=…`.

DOM code goes in `page.evaluate(fn, arg)` (or `page.eval`), which runs `fn` in the page like `ardia browse eval`.
`fn` can't see the script's variables; pass what it needs as `arg`:

```js
const min = 100;
return await page.evaluate((min) => [...document.querySelectorAll('tr')]
  .filter((row) => Number(row.cells[2]?.textContent) > min).map((row) => row.cells[0].textContent), min);
```

Return only the fields you need: the return value prints as JSON and counts toward the output cap. It stops at
`--timeout` (default 90s, at most 10m) and after any command whose outcome is unknown. A failed command throws
(`err.code`, `err.message`); uncaught, the script stops and names the line.

## Read every linked page

`read` alone is enough when you only need text:

```sh
ardia browse read --links /docs/ -s main
```

In a script, `read` returns `[{url, title, text, error}]` to filter before printing:

```sh
ardia browse script <<'EOF'
const pages = await read({ links: '/p/', selector: 'table.specs' });
return pages.filter(p => /100 W/.test(p.text)).map(p => ({ url: p.url, title: p.title }));
EOF
```

## Open each item in a list and read it

```sh
ardia browse script <<'EOF'
const out = [];
const count = await page.count('[role=listitem]');
for (let i = 0; i < count; i++) {
  await page.click(`[role=listitem] >> nth=${i}`);
  out.push(await page.text('main'));
}
return out;
EOF
```

## Scroll a list until it stops growing

```sh
ardia browse script <<'EOF'
let seen = -1;
while (seen !== await page.count('[role=option]')) {
  seen = await page.count('[role=option]');
  await page.scroll('down', 800);
  await sleep(300);
}
return await page.text('[role=listbox]');
EOF
```

## Act on every card, keep going past failures

```sh
ardia browse script <<'EOF'
const done = [], failed = [];
for (const name of ['Login bug', 'Offline queue', 'Dark mode']) {
  try {
    await page.click(`[aria-label="Actions for ${name}"]`);
    await page.click('text=Archive');
    done.push(name);
  } catch (err) {
    failed.push({ name, why: err.message });
  }
}
return { done, failed };
EOF
```

## Long jobs: keep what you gathered in `state`

`state` is one object per session that every script starts with and keeps after it ends, even when it times out.
Push rows there as you go, and pick up where you stopped in the next script:

```sh
ardia browse script --timeout 5m --out rows.json <<'EOF'
state.rows ??= [];
state.next ??= 1;
for (; state.next <= 119; state.next++) {
  await page.goto(`https://example.com/results?page=${state.next}`);
  state.rows.push(...await page.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.innerText)));
}
return state.rows;
EOF
```

## Many records: the site's public API

Before editing dozens of records, look for the site's documented public API and `curl` it with a key the site
shows you; internal `/api` calls don't count (script the UI). Creating a key changes the account: ask first.

## Anything else

`browse('tab', 'list')` runs any other command and returns `{text, data}`. `page.snapshot('-i -s main')` returns a
snapshot to search for refs. `page.wait({ text: 'Saved' })` waits for text, a URL, a load state or a function.
`page.dblclick(sel)`, `page.focus(sel)` and `page.keyboard(text)` cover cells and fields that only take typing.
