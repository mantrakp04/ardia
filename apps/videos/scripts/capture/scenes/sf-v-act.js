const op = ARG.op;
then(() => picShown().then(() => rows()).then((r) => snap("rest", { rows: r })));
then(() => slow(5));
if (op.kind === "drag") {
  drag("drag", () => refOf(op.from), placeOf(op.to), op.steps || 30);
  settle("settle", 14, 30);
} else if (op.kind === "add") {
  then(() => { const id = st().newTab(W, { url: op.url }); return sleep(2500).then(() => { st().addTabsToGroup(refOf(op.into || FOLDER), [id]); return snapFor("nest", 3000); }); });
} else if (op.kind === "nest") {
  then(() => {
    const id = st().groupTabs(op.links.map(refOf), { pinned: true, name: op.name });
    st().updateGroup(id, { parentId: folder().id });
    if (op.active) st().activate(refOf(op.active));
    return snapFor("nest", 3000);
  });
} else if (op.kind === "rename") {
  then(() => SA.startRename(W, { kind: "tab", id: refOf(op.from) }).then(() => sleep(500)).then(() => snap("field")));
  typeChars("type", op.to);
  then(() => Promise.resolve(ac.shell.devTypeKeys(W, "\r", 0)).then(() => snap("commit")));
  settle("settle", 10, 30);
}
then(() => slow(1));
then(() => sleep(1200).then(() => picShown("after")).then(() => rows()).then((r) => snap("after", { rows: r })));
return finish({ links: linksOf(folder()) });
