then(() => picShown().then(() => rows()).then((r) => snap("rest", { rows: r })));
then(() => slow(5));
watch("arrive", () => linksOf(folder()).some(([, t]) => /THE one/.test(t || "")), 3000, 120000);
then(() => slow(1));
then(() => sleep(800).then(() => rows()).then((r) => snap("after", { rows: r })));
return finish({ links: linksOf(folder()) });
