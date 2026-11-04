then(() => picShown().then(() => rows()).then((r) => snap("rest", { rows: r })));
then(() => slow(5));
watch("arrive", () => Object.values(st().groups).some((g) => g.parentId && g.name === "Methods" && g.tabIds.some((id) => /survey/.test(st().tabs[id].url))), 3500, 120000);
then(() => slow(1));
then(() => sleep(800).then(() => rows()).then((r) => snap("after", { rows: r })));
return finish({ groups: Object.values(st().groups).map((g) => [g.id, g.name, g.parentId || null, g.tabIds.length]) });
