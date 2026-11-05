then(() => sleep(1500));
["b1", "b2", "b3"].forEach((id) => then(() => { st().activate(id); return sleep(3000).then(() => picShown()); }));
warmUrls(["http://canopy.example/", "http://citydata.example/", "http://course.example/", "http://library.example/", "http://survey.example/", "http://heatmap.example/"]);
then(() => { st().activate("b3"); return sleep(3000); });
then(() => picShown().then(() => snap("rest")));
return finish({ tabs: st().windows[W].tabIds.map((id) => [id, st().tabs[id].title]), urls: Object.fromEntries(Object.values(st().tabs).map((t) => [t.id, t.url])) });
