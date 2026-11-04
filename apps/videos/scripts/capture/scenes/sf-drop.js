then(() => picShown().then(() => rows()).then((r) => snap("rest", { rows: r })));
then(() => slow(5));
drag("drag", "a6", between("a1", "a2"), 30);
settle("settle", 14, 30);
then(() => slow(1));
then(() => sleep(1200).then(() => picShown("after")).then(() => rows()).then((r) => snap("after", { rows: r })));
return finish({ links: linksOf(folder()) });
