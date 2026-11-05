then(() => sleep(1500));
(ARG.load || []).forEach((id) => then(() => { st().activate(id); return sleep(2800).then(() => picShown()); }));
warmUrls(ARG.warm || []);
const build = (spec, parent) => {
  const id = st().groupTabs(spec.links, { pinned: true, name: spec.name });
  if (parent) st().updateGroup(id, { parentId: parent });
  (spec.nested || []).forEach((n) => build(n, id));
  return id;
};
then(() => { if (ARG.build) build(ARG.build, null); st().activate(ARG.active); return sleep(3000); });
then(() => picShown().then(() => rows()).then((r) => snap("rest", { rows: r })));
return finish({ links: linksOf(folder()), urls: Object.fromEntries(Object.values(st().tabs).map((t) => [t.id, t.url])) });
