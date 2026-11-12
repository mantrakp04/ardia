let first;
then(() => { first = folder().tabIds[0]; return picShown().then(() => rows()).then((r) => snap("rest", { rows: r })); });
then(() => slow(5));
watch("arrive", () => /library/.test(st().tabs[folder().tabIds[0]].url), 3500, 120000);
then(() => slow(1));
then(() => sleep(800).then(() => rows()).then((r) => snap("after", { rows: r })));
return finish({ links: linksOf(folder()) });
