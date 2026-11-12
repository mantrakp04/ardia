let lib;
then(() => { lib = folder().tabIds.find((id) => /library/.test(st().tabs[id].url)); return picShown().then(() => rows()).then((r) => snap("rest", { rows: r })); });
then(() => slow(5));
drag("drag", () => lib, () => above(folder().tabIds[0])(), 22);
settle("settle", 14, 30);
then(() => slow(1));
then(() => sleep(1200).then(() => rows()).then((r) => snap("after", { rows: r })));
return finish({ links: linksOf(folder()) });
