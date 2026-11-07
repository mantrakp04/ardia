then(() => picShown().then(() => rows()).then((r) => snap("rest", { rows: r })));
then(() => slow(5));
drag("drag", "b3", () => { const ids = folder().tabIds; return between(ids[ids.length - 2], ids[ids.length - 1])(); }, 30);
settle("settle", 14, 30);
then(() => slow(1));
then(() => sleep(1500).then(() => picShown("after")).then(() => rows()).then((r) => snap("after", { rows: r })));
return finish({ links: linksOf(folder()) });
