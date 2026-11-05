then(() => picShown().then(() => rows()).then((r) => snap("rest", { rows: r })));
then(() => slow(5));
watch("arrive", () => linksOf(folder()).some(([, , u]) => /lecture/.test(u)), 3500, 120000);
then(() => slow(1));
then(() => sleep(800).then(() => rows()).then((r) => snap("after", { rows: r })));
return finish({ links: linksOf(folder()) });
