then(() => picShown().then(() => rows()).then((r) => snap("rest", { rows: r })));
then(() => {
  slow(5);
  const end = Date.now() + 5000;
  const loop = () => (Date.now() > end ? Promise.resolve() : snap("adding", { has: folder() ? 1 : 0 }).then(loop));
  return Promise.all([SM.openSidebarMenu(W), sleep(20).then(loop)]);
});
then(() => { slow(1); return sleep(600).then(() => rows()).then((r) => snap("added", { rows: r })); });
then(() => {
  (ARG.expand || []).forEach((n) => { const g = groupNamed(n); if (g) st().updateGroup(g.id, { collapsed: false }); });
  return sleep(800).then(() => rows()).then((r) => snap("expanded", { rows: r }));
});
return finish({ links: linksOf(folder()) });
