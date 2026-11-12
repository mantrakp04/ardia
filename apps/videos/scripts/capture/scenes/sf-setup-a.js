then(() => sleep(1500));
["a1", "a2", "a3", "a4", "a5", "a6"].forEach((id) => then(() => { st().activate(id); return sleep(3000).then(() => picShown()); }));
warmUrls(["http://lecture.example/", "http://docpad.example/", "http://lexicon.example/"]);
then(() => { st().groupTabs(["a1", "a2", "a3", "a4"], { pinned: true, name: FOLDER }); st().activate("a6"); return sleep(3000); });
then(() => picShown().then(() => snap("rest")));
return finish({ folder: folder() && folder().id, links: linksOf(folder()), urls: Object.fromEntries(Object.values(st().tabs).map((t) => [t.id, t.url])) });
