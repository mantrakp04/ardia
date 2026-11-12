let sig;
then(() => { sig = signature(); return picShown().then(() => rows()).then((r) => snap("rest", { rows: r })); });
then(() => slow(5));
watch("arrive", () => signature() !== sig, 3500, 170000);
then(() => sleep(300).then(() => rows()).then((r) => snap("settled", { rows: r })));
then(() => {
  slow(1);
  (ARG.expand || []).forEach((n) => { const g = groupNamed(n); if (g) st().updateGroup(g.id, { collapsed: false }); });
  return sleep(800).then(() => rows()).then((r) => snap("after", { rows: r }));
});
return finish({ links: linksOf(folder()) });
