then(() => picShown().then(() => rows()).then((r) => snap("rest", { rows: r })));
then(() => {
  slow(5);
  const gid = folder().id;
  const nid = st().groupTabs(["a5"], { pinned: true, name: "Methods" });
  st().updateGroup(nid, { parentId: gid });
  st().activate("a6");
  return snapFor("nest", 3500);
});
then(() => slow(1));
then(() => sleep(1000).then(() => rows()).then((r) => snap("after", { rows: r })));
return finish({ groups: Object.values(st().groups).map((g) => [g.id, g.name, g.parentId || null, g.tabIds.length]) });
