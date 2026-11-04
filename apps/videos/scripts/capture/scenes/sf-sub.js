then(() => picShown().then(() => rows()).then((r) => snap("rest", { rows: r })));
then(() => {
  slow(5);
  const gid = folder().id;
  const survey = st().tabs.a5;
  const nid = st().newNestedGroup(gid);
  const blank = st().groups[nid].tabIds[0];
  st().updateGroup(nid, { name: "Methods" });
  st().updateTab(blank, { url: survey.url, pinnedUrl: survey.url, title: survey.title, favicon: survey.favicon });
  st().closeTab("a5");
  return snapFor("nest", 3500);
});
then(() => slow(1));
then(() => sleep(1000).then(() => rows()).then((r) => snap("after", { rows: r })));
return finish({ groups: Object.values(st().groups).map((g) => [g.id, g.name, g.parentId || null, g.tabIds.length]) });
